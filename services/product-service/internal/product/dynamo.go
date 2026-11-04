package product

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

const (
	productSK     = "META"
	categoryIndex = "CategoryIndex"
)

// DynamoRepository persists products in a DynamoDB table using the following
// item collection:
//
//	PRODUCT#<id> / META   product record
//	SKU#<sku>   / LOOKUP  SKU uniqueness claim
//
// Active products are indexed by category through CategoryIndex.
type DynamoRepository struct {
	client    *dynamodb.Client
	tableName string
}

func NewDynamoRepository(ctx context.Context, tableName string) (*DynamoRepository, error) {
	tableName = strings.TrimSpace(tableName)
	if tableName == "" {
		return nil, errors.New("PRODUCTS_TABLE is not configured")
	}

	cfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}

	return NewDynamoRepositoryWithClient(dynamodb.NewFromConfig(cfg), tableName), nil
}

func NewDynamoRepositoryWithClient(client *dynamodb.Client, tableName string) *DynamoRepository {
	return &DynamoRepository{
		client:    client,
		tableName: tableName,
	}
}

func (r *DynamoRepository) Create(ctx context.Context, input CreateInput) (*Product, error) {
	now := time.Now().UTC()
	id, err := newID()
	if err != nil {
		return nil, fmt.Errorf("generate product id: %w", err)
	}

	item := Product{
		ID:          id,
		Name:        input.Name,
		Description: input.Description,
		SKU:         input.SKU,
		Category:    input.Category,
		PriceCents:  input.PriceCents,
		Currency:    input.Currency,
		Status:      StatusActive,
		Version:     1,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	productItem, err := attributevalue.MarshalMap(item.toRecord())
	if err != nil {
		return nil, fmt.Errorf("marshal product: %w", err)
	}

	skuItem, err := attributevalue.MarshalMap(skuRecord{
		PK:        "SKU#" + input.SKU,
		SK:        "LOOKUP",
		ProductID: id,
		CreatedAt: now,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal sku claim: %w", err)
	}

	_, err = r.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{
				Put: &types.Put{
					TableName:           aws.String(r.tableName),
					Item:                productItem,
					ConditionExpression: aws.String("attribute_not_exists(PK)"),
				},
			},
			{
				Put: &types.Put{
					TableName:           aws.String(r.tableName),
					Item:                skuItem,
					ConditionExpression: aws.String("attribute_not_exists(PK)"),
				},
			},
		},
	})
	if err != nil {
		return nil, mapTransactionError(err)
	}

	return &item, nil
}

func (r *DynamoRepository) Get(ctx context.Context, id string) (*Product, error) {
	out, err := r.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:      aws.String(r.tableName),
		Key:            productKey(id),
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return nil, fmt.Errorf("get product: %w", err)
	}

	if len(out.Item) == 0 {
		return nil, ErrNotFound
	}

	var rec record
	if err := attributevalue.UnmarshalMap(out.Item, &rec); err != nil {
		return nil, fmt.Errorf("unmarshal product: %w", err)
	}

	item := rec.toProduct()
	return &item, nil
}

func (r *DynamoRepository) Update(ctx context.Context, id string, input UpdateInput) (*Product, error) {
	current, err := r.Get(ctx, id)
	if err != nil {
		return nil, err
	}

	if current.Status != StatusActive {
		return nil, ErrNotFound
	}

	if current.Version != input.Version {
		return nil, ErrVersionConflict
	}

	now := time.Now().UTC()

	names := map[string]string{
		"#version":   "version",
		"#updatedAt": "updatedAt",
		"#status":    "status",
	}

	values := map[string]types.AttributeValue{
		":expectedVersion": &types.AttributeValueMemberN{Value: strconv.FormatInt(input.Version, 10)},
		":active":          &types.AttributeValueMemberS{Value: string(StatusActive)},
		":one":             &types.AttributeValueMemberN{Value: "1"},
		":updatedAt":       &types.AttributeValueMemberS{Value: now.Format(time.RFC3339Nano)},
	}

	sets := []string{
		"#updatedAt = :updatedAt",
		"#version = #version + :one",
	}

	if input.Name != nil {
		names["#name"] = "name"
		values[":name"] = &types.AttributeValueMemberS{Value: *input.Name}
		sets = append(sets, "#name = :name")
	}

	if input.Description != nil {
		names["#description"] = "description"
		values[":description"] = &types.AttributeValueMemberS{Value: *input.Description}
		sets = append(sets, "#description = :description")
	}

	if input.Category != nil {
		names["#category"] = "category"
		names["#gsi1pk"] = "GSI1PK"
		names["#gsi1sk"] = "GSI1SK"

		values[":category"] = &types.AttributeValueMemberS{Value: *input.Category}
		values[":gsi1pk"] = &types.AttributeValueMemberS{Value: "CATEGORY#" + *input.Category}
		values[":gsi1sk"] = &types.AttributeValueMemberS{
			Value: current.CreatedAt.UTC().Format(time.RFC3339Nano) + "#" + id,
		}

		sets = append(sets, "#category = :category", "#gsi1pk = :gsi1pk", "#gsi1sk = :gsi1sk")
	}

	if input.PriceCents != nil {
		names["#priceCents"] = "priceCents"
		values[":priceCents"] = &types.AttributeValueMemberN{Value: strconv.FormatInt(*input.PriceCents, 10)}
		sets = append(sets, "#priceCents = :priceCents")
	}

	if input.Currency != nil {
		names["#currency"] = "currency"
		values[":currency"] = &types.AttributeValueMemberS{Value: *input.Currency}
		sets = append(sets, "#currency = :currency")
	}

	out, err := r.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:                 aws.String(r.tableName),
		Key:                       productKey(id),
		UpdateExpression:          aws.String("SET " + strings.Join(sets, ", ")),
		ConditionExpression:       aws.String("attribute_exists(PK) AND #status = :active AND #version = :expectedVersion"),
		ExpressionAttributeNames:  names,
		ExpressionAttributeValues: values,
		ReturnValues:              types.ReturnValueAllNew,
	})
	if err != nil {
		var conditional *types.ConditionalCheckFailedException
		if errors.As(err, &conditional) {
			return nil, ErrVersionConflict
		}

		return nil, fmt.Errorf("update product: %w", err)
	}

	var rec record
	if err := attributevalue.UnmarshalMap(out.Attributes, &rec); err != nil {
		return nil, fmt.Errorf("unmarshal updated product: %w", err)
	}

	item := rec.toProduct()
	return &item, nil
}

func (r *DynamoRepository) Delete(ctx context.Context, id string) error {
	now := time.Now().UTC()

	_, err := r.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(r.tableName),
		Key:       productKey(id),
		UpdateExpression: aws.String(
			"SET #status = :archived, #updatedAt = :updatedAt, #version = #version + :one " +
				"REMOVE #gsi1pk, #gsi1sk",
		),
		ConditionExpression: aws.String("attribute_exists(PK) AND #status = :active"),
		ExpressionAttributeNames: map[string]string{
			"#status":    "status",
			"#updatedAt": "updatedAt",
			"#version":   "version",
			"#gsi1pk":    "GSI1PK",
			"#gsi1sk":    "GSI1SK",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":archived":  &types.AttributeValueMemberS{Value: string(StatusArchived)},
			":active":    &types.AttributeValueMemberS{Value: string(StatusActive)},
			":updatedAt": &types.AttributeValueMemberS{Value: now.Format(time.RFC3339Nano)},
			":one":       &types.AttributeValueMemberN{Value: "1"},
		},
	})
	if err != nil {
		var conditional *types.ConditionalCheckFailedException
		if errors.As(err, &conditional) {
			return ErrNotFound
		}

		return fmt.Errorf("delete product: %w", err)
	}

	return nil
}

func (r *DynamoRepository) ListByCategory(ctx context.Context, category string, limit int32, cursor string) (*ListResult, error) {
	category = strings.ToLower(strings.TrimSpace(category))

	if limit <= 0 {
		limit = 20
	}

	if limit > 100 {
		limit = 100
	}

	input := &dynamodb.QueryInput{
		TableName:                 aws.String(r.tableName),
		IndexName:                 aws.String(categoryIndex),
		KeyConditionExpression:    aws.String("#gsi1pk = :gsi1pk"),
		ExpressionAttributeNames:  map[string]string{"#gsi1pk": "GSI1PK"},
		ExpressionAttributeValues: map[string]types.AttributeValue{":gsi1pk": &types.AttributeValueMemberS{Value: "CATEGORY#" + category}},
		ScanIndexForward:          aws.Bool(false),
		Limit:                     aws.Int32(limit),
	}

	if cursor != "" {
		startKey, cursorCategory, err := decodeCursor(cursor)
		if err != nil {
			return nil, err
		}

		if cursorCategory != category {
			return nil, ErrInvalidCursor
		}

		input.ExclusiveStartKey = startKey
	}

	out, err := r.client.Query(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("query products: %w", err)
	}

	products := make([]Product, 0, len(out.Items))
	for _, item := range out.Items {
		var rec record
		if err := attributevalue.UnmarshalMap(item, &rec); err != nil {
			return nil, fmt.Errorf("unmarshal product: %w", err)
		}

		p := rec.toProduct()
		if p.Status == StatusActive {
			products = append(products, p)
		}
	}

	nextCursor := ""
	if len(out.LastEvaluatedKey) > 0 {
		nextCursor, err = encodeCursor(out.LastEvaluatedKey, category)
		if err != nil {
			return nil, fmt.Errorf("encode cursor: %w", err)
		}
	}

	return &ListResult{
		Products:   products,
		NextCursor: nextCursor,
	}, nil
}

type record struct {
	PK          string    `dynamodbav:"PK"`
	SK          string    `dynamodbav:"SK"`
	ID          string    `dynamodbav:"id"`
	Name        string    `dynamodbav:"name"`
	Description string    `dynamodbav:"description"`
	SKU         string    `dynamodbav:"sku"`
	Category    string    `dynamodbav:"category"`
	PriceCents  int64     `dynamodbav:"priceCents"`
	Currency    string    `dynamodbav:"currency"`
	Status      string    `dynamodbav:"status"`
	Version     int64     `dynamodbav:"version"`
	CreatedAt   time.Time `dynamodbav:"createdAt"`
	UpdatedAt   time.Time `dynamodbav:"updatedAt"`
	GSI1PK      string    `dynamodbav:"GSI1PK,omitempty"`
	GSI1SK      string    `dynamodbav:"GSI1SK,omitempty"`
}

func (p Product) toRecord() record {
	rec := record{
		PK:          "PRODUCT#" + p.ID,
		SK:          productSK,
		ID:          p.ID,
		Name:        p.Name,
		Description: p.Description,
		SKU:         p.SKU,
		Category:    p.Category,
		PriceCents:  p.PriceCents,
		Currency:    p.Currency,
		Status:      string(p.Status),
		Version:     p.Version,
		CreatedAt:   p.CreatedAt,
		UpdatedAt:   p.UpdatedAt,
	}

	if p.Status == StatusActive {
		rec.GSI1PK = "CATEGORY#" + p.Category
		rec.GSI1SK = p.CreatedAt.UTC().Format(time.RFC3339Nano) + "#" + p.ID
	}

	return rec
}

func (r record) toProduct() Product {
	return Product{
		ID:          r.ID,
		Name:        r.Name,
		Description: r.Description,
		SKU:         r.SKU,
		Category:    r.Category,
		PriceCents:  r.PriceCents,
		Currency:    r.Currency,
		Status:      Status(r.Status),
		Version:     r.Version,
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
	}
}

type skuRecord struct {
	PK        string    `dynamodbav:"PK"`
	SK        string    `dynamodbav:"SK"`
	ProductID string    `dynamodbav:"productId"`
	CreatedAt time.Time `dynamodbav:"createdAt"`
}

func productKey(id string) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{
		"PK": &types.AttributeValueMemberS{Value: "PRODUCT#" + id},
		"SK": &types.AttributeValueMemberS{Value: productSK},
	}
}

func mapTransactionError(err error) error {
	var canceled *types.TransactionCanceledException
	if errors.As(err, &canceled) {
		for index, reason := range canceled.CancellationReasons {
			if reason.Code == nil || *reason.Code != "ConditionalCheckFailed" {
				continue
			}

			if index == 1 {
				return ErrSKUExists
			}

			return ErrAlreadyExists
		}
	}

	return fmt.Errorf("create product: %w", err)
}

type cursor struct {
	PK       string `json:"pk"`
	SK       string `json:"sk"`
	GSI1PK   string `json:"gsi1pk"`
	GSI1SK   string `json:"gsi1sk"`
	Category string `json:"category"`
}

func encodeCursor(key map[string]types.AttributeValue, category string) (string, error) {
	pk, ok := stringAttribute(key, "PK")
	if !ok {
		return "", errors.New("missing PK in cursor")
	}

	sk, ok := stringAttribute(key, "SK")
	if !ok {
		return "", errors.New("missing SK in cursor")
	}

	gsi1pk, ok := stringAttribute(key, "GSI1PK")
	if !ok {
		return "", errors.New("missing GSI1PK in cursor")
	}

	gsi1sk, ok := stringAttribute(key, "GSI1SK")
	if !ok {
		return "", errors.New("missing GSI1SK in cursor")
	}

	payload, err := json.Marshal(cursor{
		PK:       pk,
		SK:       sk,
		GSI1PK:   gsi1pk,
		GSI1SK:   gsi1sk,
		Category: category,
	})
	if err != nil {
		return "", err
	}

	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func decodeCursor(value string) (map[string]types.AttributeValue, string, error) {
	payload, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, "", ErrInvalidCursor
	}

	var c cursor
	if err := json.Unmarshal(payload, &c); err != nil {
		return nil, "", ErrInvalidCursor
	}

	if c.PK == "" || c.SK == "" || c.GSI1PK == "" || c.GSI1SK == "" || c.Category == "" {
		return nil, "", ErrInvalidCursor
	}

	return map[string]types.AttributeValue{
		"PK":     &types.AttributeValueMemberS{Value: c.PK},
		"SK":     &types.AttributeValueMemberS{Value: c.SK},
		"GSI1PK": &types.AttributeValueMemberS{Value: c.GSI1PK},
		"GSI1SK": &types.AttributeValueMemberS{Value: c.GSI1SK},
	}, c.Category, nil
}

func stringAttribute(key map[string]types.AttributeValue, name string) (string, bool) {
	value, ok := key[name]
	if !ok {
		return "", false
	}

	typed, ok := value.(*types.AttributeValueMemberS)
	if !ok {
		return "", false
	}

	return typed.Value, true
}

func newID() (string, error) {
	var buf [16]byte
	if _, err := cryptorand.Read(buf[:]); err != nil {
		return "", err
	}

	buf[6] = (buf[6] & 0x0f) | 0x40
	buf[8] = (buf[8] & 0x3f) | 0x80

	return fmt.Sprintf(
		"%x-%x-%x-%x-%x",
		buf[0:4],
		buf[4:6],
		buf[6:8],
		buf[8:10],
		buf[10:16],
	), nil
}
