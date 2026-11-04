package config

import (
	"errors"
	"log"
	"os"
	"strings"
	"sync"

	"github.com/joho/godotenv"
)

var loadEnvOnce sync.Once

// Config holds runtime configuration loaded from environment variables.
type Config struct {
	Env         string
	ServiceName string
	LogLevel    string
	Version     string
}

// Load reads configuration from the environment and applies safe defaults.
// On first call it lazily loads app.env (or APP_ENV_FILE) once. Existing
// environment variables always take precedence.
func Load() Config {
	loadEnvOnce.Do(loadLocalEnv)

	return Config{
		Env:         envOrDefault("ENV", "dev"),
		ServiceName: envOrDefault("SERVICE_NAME", "product-service"),
		LogLevel:    envOrDefault("LOG_LEVEL", "info"),
		Version:     envOrDefault("VERSION", "dev"),
	}
}

func loadLocalEnv() {
	path := strings.TrimSpace(os.Getenv("APP_ENV_FILE"))
	if path == "" {
		path = "app.env"
	}

	if err := godotenv.Load(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Printf("config: load %s: %v", path, err)
	}
}

func envOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}

	return fallback
}
