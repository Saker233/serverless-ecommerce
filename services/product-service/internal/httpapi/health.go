package httpapi

import (
	"net/http"
	"time"

	"github.com/Saker233/serverless-ecommerce/services/product-service/internal/config"
	"github.com/gin-gonic/gin"
)

// HealthResponse is the public liveness payload. It intentionally does not
// perform dependency checks; those belong in a separate readiness/diagnostics
// endpoint if they are ever needed.
type HealthResponse struct {
	Status      string `json:"status"`
	Service     string `json:"service"`
	Version     string `json:"version"`
	Environment string `json:"environment"`
	Time        string `json:"time"`
}

// HealthHandler returns a shallow liveness handler.
func HealthHandler(cfg config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusOK, HealthResponse{
			Status:      "ok",
			Service:     cfg.ServiceName,
			Version:     cfg.Version,
			Environment: cfg.Env,
			Time:        time.Now().UTC().Format(time.RFC3339),
		})
	}
}
