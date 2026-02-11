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


def upload_file(service, local_path: Path, parent_id: str, name: str | None = None):
    mime, _ = mimetypes.guess_type(str(local_path))
    mime = mime or "application/octet-stream"
    body = {"name": name or local_path.name, "parents": [parent_id]}
    media = MediaFileUpload(str(local_path), mimetype=mime, resumable=True)
    f = service.files().create(body=body, media_body=media, fields="id,name").execute()
    return f


@click.command()
@click.argument("local_dir")
@click.option("--parent", required=True, help="Parent folder ID")
@click.option("--dest", required=True, help="Destination folder name (created under parent)")
def main(local_dir: str, parent: str, dest: str):
    service = get_service()
    root = Path(local_dir).resolve()
    if not root.exists() or not root.is_dir():
        raise click.ClickException(f"Not a directory: {root}")

    dest_id = create_folder(service, dest, parent)

    # create subfolders first
    folder_ids = {root: dest_id}
    for p in sorted(root.rglob('*')):
        if p.is_dir():
            # skip heavy/irrelevant
            if p.name in {'.git', 'node_modules'}:
                continue
            # also skip tools cache if any
            rel = p.relative_to(root)
            # create chain
            parent_path = p.parent
            if parent_path not in folder_ids:
                continue
            pid = folder_ids[parent_path]
            fid = create_folder(service, p.name, pid)
            folder_ids[p] = fid

    # upload files
    uploaded = 0
    for p in sorted(root.rglob('*')):
        if p.is_dir():
            if p.name in {'.git', 'node_modules'}:
                continue
            continue
        # skips
        if p.name in {'.DS_Store'}:
            continue
        if any(part in {'.git', 'node_modules'} for part in p.parts):
            continue

        # figure parent folder id
        parent_dir = p.parent
        # walk up until known
        while parent_dir not in folder_ids and parent_dir != root:
            parent_dir = parent_dir.parent
        pid = folder_ids.get(parent_dir, dest_id)

        upload_file(service, p, pid)
        uploaded += 1

    click.echo(f"Created folder: {dest} (id={dest_id})")
    click.echo(f"Uploaded files: {uploaded}")
    click.echo(f"Link: https://drive.google.com/drive/folders/{dest_id}")


if __name__ == '__main__':
    main()
