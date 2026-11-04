package httpapi

import (
	"github.com/Saker233/serverless-ecommerce/services/product-service/internal/config"
	"github.com/gin-gonic/gin"
)

func NewRouter(cfg config.Config) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)

	r := gin.New()
	r.RedirectTrailingSlash = false
	r.RedirectFixedPath = false

	r.Use(gin.Logger())
	r.Use(gin.Recovery())
	r.Use(CorrelationID())

	r.GET("/health", HealthHandler(cfg))
	return r
}
