package compatibility

import (
	"testing"
)

func TestFirefoxBrowserVersionForBypassUploadMetaHeaderCheck(t *testing.T) {
	// Test case 1: Firefox version 84 (should bypass)
	userAgent := "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:84.0) Gecko/20100101 Firefox/84.0"
	result := FirefoxBrowserVersionForBypassUploadMetaHeaderCheck(userAgent)
	if !result {
		t.Error("Test case 1 failed. Expected: true for Firefox 84")
	}

	// Test case 2: Firefox version 90 (should bypass)
	userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:90.0) Gecko/20100101 Firefox/90.0"
	result = FirefoxBrowserVersionForBypassUploadMetaHeaderCheck(userAgent)
	if !result {
		t.Error("Test case 2 failed. Expected: true for Firefox 90")
	}

	// Test case 3: Firefox version 93.9 (should bypass)
	userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:93.5) Gecko/20100101 Firefox/93.5"
	result = FirefoxBrowserVersionForBypassUploadMetaHeaderCheck(userAgent)
	if !result {
		t.Error("Test case 3 failed. Expected: true for Firefox 93.5")
	}

	// Test case 4: Firefox version 94 (should not bypass)
	userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:94.0) Gecko/20100101 Firefox/94.0"
	result = FirefoxBrowserVersionForBypassUploadMetaHeaderCheck(userAgent)
	if result {
		t.Error("Test case 4 failed. Expected: false for Firefox 94")
	}

	// Test case 5: Firefox version 95 (should not bypass)
	userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:95.0) Gecko/20100101 Firefox/95.0"
	result = FirefoxBrowserVersionForBypassUploadMetaHeaderCheck(userAgent)
	if result {
		t.Error("Test case 5 failed. Expected: false for Firefox 95")
	}

	// Test case 6: Firefox version 83 (should not bypass)
	userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:83.0) Gecko/20100101 Firefox/83.0"
	result = FirefoxBrowserVersionForBypassUploadMetaHeaderCheck(userAgent)
	if result {
		t.Error("Test case 6 failed. Expected: false for Firefox 83")
	}

	// Test case 7: Chrome browser (should return true as it's not Firefox)
	userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36"
	result = FirefoxBrowserVersionForBypassUploadMetaHeaderCheck(userAgent)
	if !result {
		t.Error("Test case 7 failed. Expected: true for Chrome")
	}

	// Test case 8: Safari browser (should return true as it's not Firefox)
	userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15"
	result = FirefoxBrowserVersionForBypassUploadMetaHeaderCheck(userAgent)
	if !result {
		t.Error("Test case 8 failed. Expected: true for Safari")
	}

	// Test case 9: Edge browser (should return true as it's not Firefox)
	userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36 Edg/96.0.1054.62"
	result = FirefoxBrowserVersionForBypassUploadMetaHeaderCheck(userAgent)
	if !result {
		t.Error("Test case 9 failed. Expected: true for Edge")
	}

	// Test case 10: Invalid Firefox version format (should return false)
	userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:invalid) Gecko/20100101 Firefox/invalid"
	result = FirefoxBrowserVersionForBypassUploadMetaHeaderCheck(userAgent)
	if result {
		t.Error("Test case 10 failed. Expected: false for invalid version")
	}

	// Test case 11: Firefox version 100+ (should not bypass)
	userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:100.0) Gecko/20100101 Firefox/100.0"
	result = FirefoxBrowserVersionForBypassUploadMetaHeaderCheck(userAgent)
	if result {
		t.Error("Test case 11 failed. Expected: false for Firefox 100")
	}
}

func TestBrowserCompatibilityOverrideContentType(t *testing.T) {
	firefoxUA := "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:94.0) Gecko/20100101 Firefox/94.0"
	chromeUA := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36"

	// Test case 1: Firefox with .ai file
	result := BrowserCompatibilityOverrideContentType(firefoxUA, "design.ai", "application/pdf")
	expected := "application/ai"
	if result != expected {
		t.Errorf("Test case 1 failed. Expected: '%s', Got: '%s'", expected, result)
	}

	// Test case 2: Firefox with .apk file
	result = BrowserCompatibilityOverrideContentType(firefoxUA, "app.apk", "application/octet-stream")
	expected = "application/apk"
	if result != expected {
		t.Errorf("Test case 2 failed. Expected: '%s', Got: '%s'", expected, result)
	}

	// Test case 3: Firefox with .iso file
	result = BrowserCompatibilityOverrideContentType(firefoxUA, "ubuntu.iso", "application/octet-stream")
	expected = "application/x-iso9660-image"
	if result != expected {
		t.Errorf("Test case 3 failed. Expected: '%s', Got: '%s'", expected, result)
	}

	// Test case 4: Firefox with regular file (should return original content type)
	result = BrowserCompatibilityOverrideContentType(firefoxUA, "document.pdf", "application/pdf")
	expected = "application/pdf"
	if result != expected {
		t.Errorf("Test case 4 failed. Expected: '%s', Got: '%s'", expected, result)
	}

	// Test case 5: Firefox with .txt file (should return original content type)
	result = BrowserCompatibilityOverrideContentType(firefoxUA, "notes.txt", "text/plain")
	expected = "text/plain"
	if result != expected {
		t.Errorf("Test case 5 failed. Expected: '%s', Got: '%s'", expected, result)
	}

	// Test case 6: Chrome with .ai file (should return original content type)
	result = BrowserCompatibilityOverrideContentType(chromeUA, "design.ai", "application/pdf")
	expected = "application/pdf"
	if result != expected {
		t.Errorf("Test case 6 failed. Expected: '%s', Got: '%s'", expected, result)
	}

	// Test case 7: Chrome with .apk file (should return original content type)
	result = BrowserCompatibilityOverrideContentType(chromeUA, "app.apk", "application/octet-stream")
	expected = "application/octet-stream"
	if result != expected {
		t.Errorf("Test case 7 failed. Expected: '%s', Got: '%s'", expected, result)
	}

	// Test case 8: Chrome with .iso file (should return original content type)
	result = BrowserCompatibilityOverrideContentType(chromeUA, "ubuntu.iso", "application/octet-stream")
	expected = "application/octet-stream"
	if result != expected {
		t.Errorf("Test case 8 failed. Expected: '%s', Got: '%s'", expected, result)
	}

	// Test case 9: Safari with .ai file (should return original content type)
	safariUA := "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15"
	result = BrowserCompatibilityOverrideContentType(safariUA, "design.ai", "application/pdf")
	expected = "application/pdf"
	if result != expected {
		t.Errorf("Test case 9 failed. Expected: '%s', Got: '%s'", expected, result)
	}

	// Test case 10: Firefox with filename in different case (.AI)
	result = BrowserCompatibilityOverrideContentType(firefoxUA, "design.AI", "application/pdf")
	expected = "application/pdf" // Extension matching is case-sensitive
	if result != expected {
		t.Errorf("Test case 10 failed. Expected: '%s', Got: '%s'", expected, result)
	}

	// Test case 11: Firefox with no extension
	result = BrowserCompatibilityOverrideContentType(firefoxUA, "noextension", "application/octet-stream")
	expected = "application/octet-stream"
	if result != expected {
		t.Errorf("Test case 11 failed. Expected: '%s', Got: '%s'", expected, result)
	}

	// Test case 12: Firefox with multiple extensions
	result = BrowserCompatibilityOverrideContentType(firefoxUA, "file.tar.iso", "application/x-tar")
	expected = "application/x-iso9660-image"
	if result != expected {
		t.Errorf("Test case 12 failed. Expected: '%s', Got: '%s'", expected, result)
	}
}
