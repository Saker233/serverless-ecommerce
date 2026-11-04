package main

import (
	"context"
	"log"
	"strings"

	"github.com/Saker233/serverless-ecommerce/services/product-service/internal/config"
	"github.com/Saker233/serverless-ecommerce/services/product-service/internal/httpapi"
	"github.com/Saker233/serverless-ecommerce/services/product-service/internal/product"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	ginadapter "github.com/awslabs/aws-lambda-go-api-proxy/gin"
)

var version = "dev"

var adapter *ginadapter.GinLambdaV2

func init() {
	cfg := config.Load()
	cfg.Version = version

	repo, err := product.NewDynamoRepository(context.Background(), cfg.ProductsTable)
	if err != nil {
		log.Printf("product repository disabled: %v", err)
	}

	adapter = ginadapter.NewV2(httpapi.NewRouter(cfg, repo))
}

func main() {
	lambda.Start(handler)
}

func handler(ctx context.Context, req events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	injectCorrelationID(&req)
	return adapter.ProxyWithContext(ctx, req)
}

// injectCorrelationID makes the API Gateway request ID available to the
// HTTP middleware while preserving a client-supplied correlation ID.
func injectCorrelationID(req *events.APIGatewayV2HTTPRequest) {
	if req.Headers == nil {
		req.Headers = make(map[string]string)
	}

	for key, value := range req.Headers {
		if !strings.EqualFold(key, "X-Correlation-Id") {
			continue
		}

		if strings.TrimSpace(value) != "" {
			return
		}

		delete(req.Headers, key)
	}

	if req.RequestContext.RequestID != "" {
		req.Headers["X-Correlation-Id"] = req.RequestContext.RequestID
	}
}
