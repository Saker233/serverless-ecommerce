package main

import (
	"context"
	"log"

	"github.com/Saker233/serverless-ecommerce/services/product-service/internal/config"
	"github.com/Saker233/serverless-ecommerce/services/product-service/internal/httpapi"
	"github.com/Saker233/serverless-ecommerce/services/product-service/internal/product"
)

var version = "dev"

func main() {
	cfg := config.Load()
	cfg.Version = version

	repo, err := product.NewDynamoRepository(context.Background(), cfg.ProductsTable)
	if err != nil {
		log.Printf("product repository disabled: %v", err)
	}

	r := httpapi.NewRouter(cfg, repo)
	if err := r.Run(":8000"); err != nil {
		log.Fatal(err)
	}
}
