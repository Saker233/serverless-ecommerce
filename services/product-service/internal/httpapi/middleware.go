package httpapi

import (
	cryptorand "crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const RequestIDKey = "request_id"

const (
	correlationIDHeader = "X-Correlation-Id"
	maxRequestIDLength  = 128
)

// CorrelationID extracts a client-supplied request ID or generates one, then
// exposes it to handlers and echoes it back in the response.
func CorrelationID() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := requestIDFromRequest(c.Request)
		c.Set(RequestIDKey, requestID)
		c.Header(correlationIDHeader, requestID)

		c.Next()
	}
}

func requestIDFromRequest(r *http.Request) string {
	for _, header := range []string{correlationIDHeader, "X-Request-Id"} {
		value := strings.TrimSpace(r.Header.Get(header))
		if isSafeRequestID(value) {
			return value
		}
	}

	return newRequestID()
}

func isSafeRequestID(value string) bool {
	if value == "" || len(value) > maxRequestIDLength {
		return false
	}

	for _, r := range value {
		if r < 0x21 || r > 0x7e {
			return false
		}
	}

	return true
}

func newRequestID() string {
	var buf [16]byte
	if _, err := cryptorand.Read(buf[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}

	return hex.EncodeToString(buf[:])
}
