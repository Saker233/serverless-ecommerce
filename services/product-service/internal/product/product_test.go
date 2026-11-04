package product

import (
	"errors"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

func TestCreateInputNormalize(t *testing.T) {
	input := CreateInput{
		Name:        "  Mechanical Keyboard ",
		Description: "  A keyboard  ",
		SKU:         " kb-001 ",
		Category:    " Electronics ",
		PriceCents:  4999,
		Currency:    " eur ",
	}

	if err := input.Normalize(); err != nil {
		t.Fatalf("normalize: %v", err)
	}

	if input.Name != "Mechanical Keyboard" {
		t.Fatalf("unexpected name: %q", input.Name)
	}

	if input.SKU != "KB-001" {
		t.Fatalf("unexpected sku: %q", input.SKU)
	}

	if input.Category != "electronics" {
		t.Fatalf("unexpected category: %q", input.Category)
	}

	if input.Currency != "EUR" {
		t.Fatalf("unexpected currency: %q", input.Currency)
	}
}

func TestCreateInputRejectsInvalidValues(t *testing.T) {
	tests := []struct {
		name  string
		input CreateInput
	}{
		{
			name:  "missing name",
			input: CreateInput{SKU: "KB-001", Category: "electronics", PriceCents: 100, Currency: "EUR"},
		},
		{
			name:  "invalid sku",
			input: CreateInput{Name: "Keyboard", SKU: "KB 001", Category: "electronics", PriceCents: 100, Currency: "EUR"},
		},
		{
			name:  "invalid category",
			input: CreateInput{Name: "Keyboard", SKU: "KB-001", Category: "Electronics!", PriceCents: 100, Currency: "EUR"},
		},
		{
			name:  "zero price",
			input: CreateInput{Name: "Keyboard", SKU: "KB-001", Category: "electronics", PriceCents: 0, Currency: "EUR"},
		},
		{
			name:  "invalid currency",
			input: CreateInput{Name: "Keyboard", SKU: "KB-001", Category: "electronics", PriceCents: 100, Currency: "EURO"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var validation ValidationError
			if err := tt.input.Normalize(); !errors.As(err, &validation) {
				t.Fatalf("expected ValidationError, got %v", err)
			}
		})
	}
}

func TestUpdateInputNormalize(t *testing.T) {
	name := "  New name "
	category := " Home-Garden "
	currency := " usd "

	input := UpdateInput{
		Name:     &name,
		Category: &category,
		Currency: &currency,
		Version:  3,
	}

	if err := input.Normalize(); err != nil {
		t.Fatalf("normalize: %v", err)
	}

	if input.Name == nil || *input.Name != "New name" {
		t.Fatalf("unexpected name: %v", input.Name)
	}

	if input.Category == nil || *input.Category != "home-garden" {
		t.Fatalf("unexpected category: %v", input.Category)
	}

	if input.Currency == nil || *input.Currency != "USD" {
		t.Fatalf("unexpected currency: %v", input.Currency)
	}
}

func TestUpdateInputRequiresVersionAndField(t *testing.T) {
	var validation ValidationError

	if err := (&UpdateInput{}).Normalize(); !errors.As(err, &validation) {
		t.Fatalf("expected missing version error, got %v", err)
	}

	if err := (&UpdateInput{Version: 1}).Normalize(); !errors.As(err, &validation) {
		t.Fatalf("expected missing field error, got %v", err)
	}
}

func TestRecordRoundTrip(t *testing.T) {
	now := time.Now().UTC()
	item := Product{
		ID:          "product-1",
		Name:        "Keyboard",
		Description: "A keyboard",
		SKU:         "KB-001",
		Category:    "electronics",
		PriceCents:  4999,
		Currency:    "EUR",
		Status:      StatusActive,
		Version:     1,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	raw, err := attributevalue.MarshalMap(item.toRecord())
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var rec record
	if err := attributevalue.UnmarshalMap(raw, &rec); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	got := rec.toProduct()
	if got.ID != item.ID || got.SKU != item.SKU || got.Category != item.Category {
		t.Fatalf("unexpected product: %#v", got)
	}

	if !got.CreatedAt.Equal(item.CreatedAt) {
		t.Fatalf("unexpected createdAt: %v != %v", got.CreatedAt, item.CreatedAt)
	}

	if rec.GSI1PK != "CATEGORY#electronics" {
		t.Fatalf("unexpected GSI1PK: %q", rec.GSI1PK)
	}
}

func TestCursorRoundTrip(t *testing.T) {
	key := map[string]types.AttributeValue{
		"PK":     &types.AttributeValueMemberS{Value: "PRODUCT#1"},
		"SK":     &types.AttributeValueMemberS{Value: "META"},
		"GSI1PK": &types.AttributeValueMemberS{Value: "CATEGORY#electronics"},
		"GSI1SK": &types.AttributeValueMemberS{Value: "2026-11-04T00:00:00Z#1"},
	}

	encoded, err := encodeCursor(key, "electronics")
	if err != nil {
		t.Fatalf("encode: %v", err)
	}

	decoded, category, err := decodeCursor(encoded)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}

	if category != "electronics" {
		t.Fatalf("unexpected cursor category: %q", category)
	}

	for name := range key {
		got, ok := stringAttribute(decoded, name)
		if !ok {
			t.Fatalf("missing %s", name)
		}

		want, ok := stringAttribute(key, name)
		if !ok {
			t.Fatalf("invalid test key %s", name)
		}

		if got != want {
			t.Fatalf("%s: got %q, want %q", name, got, want)
		}
	}
}

func TestDecodeCursorRejectsInvalidValue(t *testing.T) {
	if _, _, err := decodeCursor("not-a-cursor"); !errors.Is(err, ErrInvalidCursor) {
		t.Fatalf("expected ErrInvalidCursor, got %v", err)
	}
}
