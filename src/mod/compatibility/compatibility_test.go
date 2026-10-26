package compatibility

import (
	"testing"
)

func TestFirefoxBrowserVersionForBypassUploadMetaHeaderCheck(t *testing.T) {
	tests := []struct {
		name      string
		userAgent string
		expected  bool
	}{
		{
			name:      "Firefox v84 (bypass)",
			userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:84.0) Gecko/20100101 Firefox/84.0",
			expected:  true,
		},
		{
			name:      "Firefox v90 (bypass)",
			userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:90.0) Gecko/20100101 Firefox/90.0",
			expected:  true,
		},
		{
			name:      "Firefox v93 (bypass)",
			userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:93.0) Gecko/20100101 Firefox/93.0",
			expected:  true,
		},
		{
			name:      "Firefox v94 (no bypass)",
			userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:94.0) Gecko/20100101 Firefox/94.0",
			expected:  false,
		},
		{
			name:      "Firefox v100 (no bypass)",
			userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:100.0) Gecko/20100101 Firefox/100.0",
			expected:  false,
		},
		{
			name:      "Chrome (not Firefox)",
			userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/91.0.4472.124",
			expected:  true,
		},
		{
			name:      "Empty user agent",
			userAgent: "",
			expected:  true,
		},
		{
			name:      "Safari",
			userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Safari/605.1.15",
			expected:  true,
		},
		{
			name:      "Firefox v83 (too old, no bypass)",
			userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:83.0) Gecko/20100101 Firefox/83.0",
			expected:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := FirefoxBrowserVersionForBypassUploadMetaHeaderCheck(tt.userAgent)
			if result != tt.expected {
				t.Errorf("FirefoxBrowserVersionForBypassUploadMetaHeaderCheck(%q) = %v, want %v", tt.userAgent, result, tt.expected)
			}
		})
	}
}

func TestBrowserCompatibilityOverrideContentType(t *testing.T) {
	firefoxUA := "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:94.0) Gecko/20100101 Firefox/94.0"
	chromeUA := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/91.0.4472.124"

	tests := []struct {
		name        string
		userAgent   string
		filename    string
		contentType string
		expected    string
	}{
		{
			name:        "Firefox AI file",
			userAgent:   firefoxUA,
			filename:    "document.ai",
			contentType: "application/pdf",
			expected:    "application/ai",
		},
		{
			name:        "Firefox APK file",
			userAgent:   firefoxUA,
			filename:    "app.apk",
			contentType: "application/octet-stream",
			expected:    "application/apk",
		},
		{
			name:        "Firefox ISO file",
			userAgent:   firefoxUA,
			filename:    "disk.iso",
			contentType: "application/octet-stream",
			expected:    "application/x-iso9660-image",
		},
		{
			name:        "Firefox regular file",
			userAgent:   firefoxUA,
			filename:    "document.pdf",
			contentType: "application/pdf",
			expected:    "application/pdf",
		},
		{
			name:        "Chrome AI file (no override)",
			userAgent:   chromeUA,
			filename:    "document.ai",
			contentType: "application/pdf",
			expected:    "application/pdf",
		},
		{
			name:        "Non-Firefox browser",
			userAgent:   "Mozilla/5.0 Safari/537.36",
			filename:    "document.ai",
			contentType: "application/pdf",
			expected:    "application/pdf",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := BrowserCompatibilityOverrideContentType(tt.userAgent, tt.filename, tt.contentType)
			if result != tt.expected {
				t.Errorf("BrowserCompatibilityOverrideContentType() = %q, want %q", result, tt.expected)
			}
		})
	}
}
