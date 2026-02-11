#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "google-api-python-client>=2.0.0",
#   "google-auth>=2.0.0",
#   "click>=8.0.0"
# ]
# ///

from pathlib import Path

import click
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

TOKEN_FILE = Path.home() / ".simple-google-workspace" / "token.json"


def get_creds():
    if not TOKEN_FILE.exists():
        raise click.ClickException("Not authenticated. Run: uv run skills/ez-google/scripts/auth.py login")
    return Credentials.from_authorized_user_file(TOKEN_FILE)


@click.command()
@click.option("--parent", required=True, help="Drive folder ID to place the Doc in")
@click.option("--title", required=True)
@click.argument("text_file")
def main(parent: str, title: str, text_file: str):
    creds = get_creds()
    docs = build("docs", "v1", credentials=creds)
    drive = build("drive", "v3", credentials=creds)

    p = Path(text_file).expanduser().resolve()
    text = p.read_text(encoding="utf-8")

    doc = docs.documents().create(body={"title": title}).execute()
    doc_id = doc["documentId"]

    # insert content at start
    docs.documents().batchUpdate(
        documentId=doc_id,
        body={
            "requests": [
                {
                    "insertText": {
                        "location": {"index": 1},
                        "text": text,
                    }
                }
            ]
        },
    ).execute()

    # move doc into folder
    drive.files().update(
        fileId=doc_id,
        addParents=parent,
        fields="id, parents, webViewLink",
    ).execute()

    link = f"https://docs.google.com/document/d/{doc_id}/edit"
    click.echo(f"Created Doc: {title}")
    click.echo(f"ID: {doc_id}")
    click.echo(f"Link: {link}")


if __name__ == "__main__":
    main()
