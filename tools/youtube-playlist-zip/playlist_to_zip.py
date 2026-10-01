#!/usr/bin/env python3
"""Download every video in a YouTube playlist and pack them into one ZIP file.

Usage:
    python playlist_to_zip.py                      # asks for the playlist link
    python playlist_to_zip.py <playlist-url>
    python playlist_to_zip.py <playlist-url> --audio      # MP3 only
    python playlist_to_zip.py <playlist-url> --max-height 720
    python playlist_to_zip.py <playlist-url> -o ~/Downloads
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

try:
    import yt_dlp
except ImportError:
    sys.exit("yt-dlp is not installed. Run:  pip install -r requirements.txt")


def safe_filename(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", name).strip(" .")
    return name[:150] or "playlist"


def build_options(work_dir: Path, audio_only: bool, max_height: int | None) -> dict:
    has_ffmpeg = shutil.which("ffmpeg") is not None

    if audio_only:
        if has_ffmpeg:
            fmt = "bestaudio/best"
            postprocessors = [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}]
        else:
            print("ffmpeg not found - saving audio in its original format (m4a/webm) instead of MP3.")
            fmt = "bestaudio[ext=m4a]/bestaudio/best"
            postprocessors = []
    else:
        height = f"[height<={max_height}]" if max_height else ""
        if has_ffmpeg:
            # Best video + best audio, merged into a single MP4.
            fmt = f"bestvideo{height}[ext=mp4]+bestaudio[ext=m4a]/bestvideo{height}+bestaudio/best{height}/best"
        else:
            # Without ffmpeg only pre-merged files can be used (usually up to 720p).
            print("ffmpeg not found - downloading pre-merged files only (quality is usually limited to 720p).")
            fmt = f"best{height}[ext=mp4][acodec!=none][vcodec!=none]/best{height}[acodec!=none][vcodec!=none]/best"
        postprocessors = []

    return {
        "format": fmt,
        "merge_output_format": "mp4",
        "postprocessors": postprocessors,
        # "001 - Title.mp4" keeps the playlist order inside the ZIP.
        "outtmpl": str(work_dir / "%(playlist_index|0)03d - %(title).120B [%(id)s].%(ext)s"),
        "restrictfilenames": False,
        "windowsfilenames": True,
        "ignoreerrors": True,  # skip private/deleted/blocked videos instead of stopping
        "noplaylist": False,
        "retries": 5,
        "fragment_retries": 5,
        "quiet": False,
        "no_warnings": False,
    }


def make_zip(files: list[Path], zip_path: Path, folder_name: str) -> None:
    # Videos are already compressed, so store them as-is (much faster, same size).
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zf:
        for f in files:
            zf.write(f, arcname=f"{folder_name}/{f.name}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Download a YouTube playlist into a ZIP file.")
    parser.add_argument("url", nargs="?", help="Playlist link (if omitted, you will be asked for it)")
    parser.add_argument("-o", "--output-dir", default=".", help="Where to save the ZIP (default: current folder)")
    parser.add_argument("--audio", action="store_true", help="Download audio only (MP3)")
    parser.add_argument("--max-height", type=int, help="Maximum video height, e.g. 720 or 1080")
    args = parser.parse_args()

    url = args.url or input("Paste the YouTube playlist link: ").strip()
    if not url:
        print("No link given.")
        return 1

    out_dir = Path(args.output_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    # Work inside the output folder so large playlists don't fill a small system temp drive.
    with tempfile.TemporaryDirectory(prefix=".playlist-download-", dir=out_dir) as tmp:
        work_dir = Path(tmp)
        with yt_dlp.YoutubeDL(build_options(work_dir, args.audio, args.max_height)) as ydl:
            info = ydl.extract_info(url, download=True)

        if not info:
            print("Could not read this link. Make sure it is a public (or unlisted) playlist.")
            return 1

        title = safe_filename(info.get("title") or info.get("id") or "playlist")
        files = sorted(p for p in work_dir.iterdir() if p.is_file() and not p.name.endswith((".part", ".ytdl")))
        if not files:
            print("No videos were downloaded.")
            return 1

        expected = info.get("playlist_count") or len(info.get("entries") or [info])

        zip_path = out_dir / f"{title}.zip"
        n = 1
        while zip_path.exists():
            zip_path = out_dir / f"{title} ({n}).zip"
            n += 1

        print(f"\nCreating {zip_path.name} ...")
        make_zip(files, zip_path, title)

    size_mb = zip_path.stat().st_size / (1024 * 1024)
    print(f"\nDone! {len(files)} file(s), {size_mb:.1f} MB")
    print(f"Saved to: {zip_path}")
    if len(files) < expected:
        print(f"Note: {expected - len(files)} video(s) were skipped (private, deleted or unavailable).")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nCancelled.")
        sys.exit(130)
