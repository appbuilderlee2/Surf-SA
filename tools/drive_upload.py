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


@click.command()
@click.argument("path")
@click.option("--parent", required=True, help="Parent folder ID")
@click.option("--name", help="Override file name")
def main(path: str, parent: str, name: str | None):
    svc = get_service()
    p = Path(path)
    if not p.exists():
        raise click.ClickException(f"File not found: {p}")

    mime, _ = mimetypes.guess_type(str(p))
    mime = mime or "application/octet-stream"

    body = {"name": name or p.name, "parents": [parent]}
    media = MediaFileUpload(str(p), mimetype=mime, resumable=True)

    f = svc.files().create(body=body, media_body=media, fields="id,name,webViewLink").execute()
    click.echo(f"Uploaded: {f['name']}")
    click.echo(f"ID: {f['id']}")
    click.echo(f"Link: {f.get('webViewLink')}")


if __name__ == "__main__":
    main()
