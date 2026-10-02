package email

/*
	secretbox.go

	Seals account passwords, OAuth refresh tokens and OAuth client secrets
	with AES-256-GCM before they reach the database. The key is a single
	0600 file next to the mail database, created on first use, so a copy of
	mail.db alone never discloses anyone's mailbox password.
*/

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const keyFileName = "secret.key"

// secretBox seals and opens short secrets.
type secretBox struct {
	aead cipher.AEAD
}

// loadSecretBox reads the key from dir, generating one on first run.
func loadSecretBox(dir string) (*secretBox, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}

	keyFile := filepath.Join(dir, keyFileName)
	var key []byte
	if content, err := os.ReadFile(keyFile); err == nil {
		decoded, derr := base64.StdEncoding.DecodeString(strings.TrimSpace(string(content)))
		if derr == nil && len(decoded) == 32 {
			key = decoded
		}
	}

	if key == nil {
		//A missing or damaged key only costs users their saved passwords,
		//which the UI asks for again (the account reports an auth error).
		key = make([]byte, 32)
		if _, err := rand.Read(key); err != nil {
			return nil, err
		}
		if err := os.WriteFile(keyFile, []byte(base64.StdEncoding.EncodeToString(key)), 0600); err != nil {
			return nil, err
		}
	}

	return newSecretBox(key)
}

func newSecretBox(key []byte) (*secretBox, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &secretBox{aead: aead}, nil
}

// Seal encrypts plaintext and returns base64(nonce || ciphertext). An empty
// plaintext seals to an empty string so "no secret" stays recognisable.
func (s *secretBox) Seal(plaintext string) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := s.aead.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// Open reverses Seal.
func (s *secretBox) Open(encoded string) (string, error) {
	if encoded == "" {
		return "", nil
	}
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	if len(raw) < s.aead.NonceSize() {
		return "", errors.New("sealed secret is truncated")
	}
	nonce, ciphertext := raw[:s.aead.NonceSize()], raw[s.aead.NonceSize():]
	plaintext, err := s.aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", errors.New("stored secret cannot be decrypted, please sign in again")
	}
	return string(plaintext), nil
}
