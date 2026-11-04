package httpapi

import (
	"github.com/Saker233/serverless-ecommerce/services/product-service/internal/config"
	"github.com/Saker233/serverless-ecommerce/services/product-service/internal/product"
	"github.com/gin-gonic/gin"
)

func NewRouter(cfg config.Config, products product.Repository) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)

	r := gin.New()
	r.RedirectTrailingSlash = false
	r.RedirectFixedPath = false

	r.Use(gin.Logger())
	r.Use(gin.Recovery())
	r.Use(CorrelationID())

	productHandler := NewProductHandler(products)

	r.GET("/health", HealthHandler(cfg))
	r.POST("/products", productHandler.Create)
	r.GET("/products", productHandler.List)
	r.GET("/products/:id", productHandler.Get)
	r.PUT("/products/:id", productHandler.Update)
	r.DELETE("/products/:id", productHandler.Delete)

	return r
}
