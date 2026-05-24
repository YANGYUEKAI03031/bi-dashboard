"""
Tests for datasource password encryption (Fernet).
"""
import pytest
import sys
import os

# Generate a real Fernet key for testing BEFORE importing the app modules
# This is needed because the crypto module reads config at import time
from cryptography.fernet import Fernet
TEST_ENCRYPTION_KEY = Fernet.generate_key().decode()
os.environ["ENCRYPTION_KEY"] = TEST_ENCRYPTION_KEY

# Now we can safely import app modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))


class TestCryptoModule:
    """Tests for crypto.py functions."""

    def test_encrypt_decrypt_roundtrip(self):
        """Encrypted password should decrypt back to original."""
        from app.core.crypto import encrypt_password, decrypt_password

        original = "my_secret_password_123"
        encrypted = encrypt_password(original)
        decrypted = decrypt_password(encrypted)

        assert decrypted == original
        assert encrypted != original

    def test_encrypted_password_is_different(self):
        """Same password should produce different encrypted values (due to random IV)."""
        from app.core.crypto import encrypt_password

        password = "test_password"
        enc1 = encrypt_password(password)
        enc2 = encrypt_password(password)

        # Both should decrypt to same value but be different encrypted strings
        assert enc1 != enc2

    def test_decrypt_plaintext_backwards_compatible(self):
        """Old plaintext passwords should decrypt to themselves (backwards compatibility)."""
        from app.core.crypto import decrypt_password

        plaintext = "old_password_123"
        # When a plaintext password is stored (before migration),
        # decrypt_password should return it as-is
        decrypted = decrypt_password(plaintext)
        assert decrypted == plaintext

    def test_empty_password(self):
        """Empty passwords should be handled gracefully."""
        from app.core.crypto import encrypt_password, decrypt_password

        assert encrypt_password("") == ""
        assert decrypt_password("") == ""

    def test_special_characters(self):
        """Passwords with special characters should encrypt/decrypt correctly."""
        from app.core.crypto import encrypt_password, decrypt_password

        password = "P@$$w0rd!#%^&*()_+-=[]{}|;':\",./<>?"
        encrypted = encrypt_password(password)
        decrypted = decrypt_password(encrypted)

        assert decrypted == password

    def test_unicode_password(self):
        """Unicode passwords should work correctly."""
        from app.core.crypto import encrypt_password, decrypt_password

        password = "密码テスト🔐"
        encrypted = encrypt_password(password)
        decrypted = decrypt_password(encrypted)

        assert decrypted == password

    def test_is_plaintext_detection(self):
        """Plaintext vs encrypted detection should work correctly."""
        from app.core.crypto import _is_plaintext, encrypt_password

        # Plaintext
        assert _is_plaintext("simple_password") is True
        assert _is_plaintext("") is True

        # Encrypted
        encrypted = encrypt_password("test")
        assert _is_plaintext(encrypted) is False
