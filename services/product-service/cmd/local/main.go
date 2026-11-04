package main

import (
	"log"

	"github.com/Saker233/serverless-ecommerce/services/product-service/internal/config"
	"github.com/Saker233/serverless-ecommerce/services/product-service/internal/httpapi"
)

var version = "dev"

func main() {
	cfg := config.Load()
	cfg.Version = version
	r := httpapi.NewRouter(cfg)
	if err := r.Run(":8000"); err != nil {
		log.Fatal(err)
	}
}
