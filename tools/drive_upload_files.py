#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["google-api-python-client>=2.0.0", "google-auth>=2.0.0", "click>=8.0.0"]
# ///

import mimetypes
from pathlib import Path

import click
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

TOKEN_FILE = Path.home() / ".simple-google-workspace" / "token.json"


def get_service():
    if not TOKEN_FILE.exists():
        raise click.ClickException("Not authenticated. Run: uv run skills/ez-google/scripts/auth.py login")
    creds = Credentials.from_authorized_user_file(TOKEN_FILE)
    return build("drive", "v3", credentials=creds)


def create_folder(service, name: str, parent_id: str) -> str:
    body = {"name": name, "mimeType": "application/vnd.google-apps.folder", "parents": [parent_id]}
    f = service.files().create(body=body, fields="id").execute()
    return f["id"]


def upload_file(service, local_path: Path, parent_id: str):
    mime, _ = mimetypes.guess_type(str(local_path))
    mime = mime or "application/octet-stream"
    body = {"name": local_path.name, "parents": [parent_id]}
    media = MediaFileUpload(str(local_path), mimetype=mime, resumable=True)
    f = service.files().create(body=body, media_body=media, fields="id,name,webViewLink").execute()
    return f


@click.command()
@click.option("--parent", required=True, help="Parent folder ID")
@click.option("--dest", required=True, help="Destination folder name")
@click.argument("files", nargs=-1)
def main(parent: str, dest: str, files: list[str]):
    service = get_service()
    if not files:
        raise click.ClickException("No files given")

    dest_id = create_folder(service, dest, parent)
    uploaded = []
    for f in files:
        p = Path(f).expanduser().resolve()
        if not p.exists() or not p.is_file():
            raise click.ClickException(f"Not a file: {p}")
        uploaded.append(upload_file(service, p, dest_id))

    click.echo(f"Created folder: {dest} (id={dest_id})")
    click.echo(f"Uploaded files: {len(uploaded)}")
    click.echo(f"Link: https://drive.google.com/drive/folders/{dest_id}")


if __name__ == '__main__':
    main()
