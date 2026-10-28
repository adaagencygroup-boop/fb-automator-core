import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from fastapi import UploadFile
from starlette.datastructures import Headers

from modules.module_07_group_spam.app.services import media_service


class MediaServiceTests(unittest.TestCase):
    @patch.object(media_service, "is_supabase_storage_available", return_value=False)
    def test_upload_returns_token_and_resolves_inside_upload_directory(self, _mock_storage):
        with tempfile.TemporaryDirectory() as directory, patch.object(
            media_service, "UPLOAD_MEDIA_DIR", Path(directory).resolve()
        ):
            upload = UploadFile(
                file=BytesIO(b"fake-image"), filename="photo.jpg",
                headers=Headers({"content-type": "image/jpeg"}),
            )
            saved = media_service.save_uploaded_media([upload], campaign_id="camp-test")[0]
            self.assertTrue(saved["path"].endswith(saved["saved_name"]))
            self.assertFalse(Path(str(saved["path"])).is_absolute())
            resolved = media_service.resolve_media_paths([str(saved["path"])])
            self.assertTrue(Path(resolved[0]).is_file())

    def test_rejects_unsupported_upload_and_path_traversal(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(
            media_service, "UPLOAD_MEDIA_DIR", Path(directory).resolve()
        ):
            upload = UploadFile(
                file=BytesIO(b"payload"), filename="payload.exe",
                headers=Headers({"content-type": "application/octet-stream"}),
            )
            with self.assertRaises(media_service.MediaStorageError):
                media_service.save_uploaded_media([upload])
            with self.assertRaises(media_service.MediaStorageError):
                media_service.resolve_media_paths(["../secret.jpg"])


if __name__ == "__main__":
    unittest.main()
