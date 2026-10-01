#!/usr/bin/env python3
"""Download every video in a YouTube playlist and pack them into ZIP files of up to 30 MB each.

Usage:
    python playlist_to_zip.py                      # asks for the playlist link
    python playlist_to_zip.py <playlist-url>
    python playlist_to_zip.py <playlist-url> --audio      # MP3 only
    python playlist_to_zip.py <playlist-url> --max-height 720
    python playlist_to_zip.py <playlist-url> -o ~/Downloads
    python playlist_to_zip.py <playlist-url> --max-size 25   # ZIPs of up to 25 MB
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
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


MB = 1_000_000  # "30 MB" as file-size limits count it (slightly smaller than 30 MiB, so always safe)
ZIP_ENTRY_OVERHEAD = 200  # per-file ZIP headers, on top of the name (stored twice)
ZIP_END_RESERVE = 1024  # end-of-archive records


def entry_cost(f: Path, folder: str) -> int:
    return f.stat().st_size + 2 * len(f"{folder}/{f.name}".encode()) + ZIP_ENTRY_OVERHEAD


def media_duration(path: Path) -> float | None:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        return float(out)
    except (OSError, subprocess.CalledProcessError, ValueError):
        return None


def split_media(path: Path, limit: int) -> list[Path] | None:
    """Cut a video/audio file into playable pieces of at most `limit` bytes (needs ffmpeg)."""
    if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
        return None
    duration = media_duration(path)
    if not duration:
        return None

    seg_time = duration * (limit * 0.85) / path.stat().st_size
    tmp = Path(tempfile.mkdtemp(prefix=".split-", dir=path.parent))
    try:
        # Cuts happen on keyframes, so pieces vary in size; shorten the pieces until all fit.
        for _ in range(8):
            for old in tmp.iterdir():
                old.unlink()
            result = subprocess.run(
                ["ffmpeg", "-v", "error", "-y", "-i", str(path), "-map", "0:v?", "-map", "0:a?", "-c", "copy",
                 "-f", "segment", "-segment_time", f"{seg_time:.3f}", "-reset_timestamps", "1",
                 str(tmp / f"%04d{path.suffix}")],
                capture_output=True,
            )
            pieces = sorted(tmp.iterdir())
            if result.returncode == 0 and pieces and all(p.stat().st_size <= limit for p in pieces):
                final = []
                for i, piece in enumerate(pieces, 1):
                    target = path.with_name(f"{path.stem} - part {i} of {len(pieces)}{path.suffix}")
                    piece.replace(target)
                    final.append(target)
                path.unlink()
                return final
            seg_time *= 0.6
        return None
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def split_bytes(path: Path, limit: int) -> list[Path]:
    """Last resort: raw chunks (name.mp4.001, .002, ...) that must be joined before playing."""
    pieces = []
    with path.open("rb") as src:
        i = 1
        while chunk := src.read(limit):
            piece = path.with_name(f"{path.name}.{i:03d}")
            piece.write_bytes(chunk)
            pieces.append(piece)
            i += 1
    path.unlink()
    return pieces


def fit_files(files: list[Path], max_bytes: int, folder: str) -> tuple[list[Path], list[Path]]:
    """Split every file that can't fit in a ZIP of `max_bytes` on its own. Returns (files, raw-split files)."""
    result, raw_split = [], []
    for f in files:
        if entry_cost(f, folder) + ZIP_END_RESERVE <= max_bytes:
            result.append(f)
            continue
        # Leave room for the longer " - part N of M" name and the ZIP headers.
        limit = max_bytes - ZIP_END_RESERVE - ZIP_ENTRY_OVERHEAD - 2 * len(f"{folder}/{f.name} - part 999 of 999".encode())
        print(f"Splitting {f.name} ({f.stat().st_size / MB:.1f} MB) into smaller pieces ...")
        pieces = split_media(f, limit)
        if pieces is None:
            pieces = split_bytes(f, limit)
            raw_split.append(f)
        result.extend(pieces)
    return result, raw_split


def group_files(files: list[Path], max_bytes: int, folder: str) -> list[list[Path]]:
    """Fill ZIPs in playlist order, starting a new one whenever the next file would exceed the limit."""
    groups, current, size = [], [], ZIP_END_RESERVE
    for f in files:
        cost = entry_cost(f, folder)
        if current and size + cost > max_bytes:
            groups.append(current)
            current, size = [], ZIP_END_RESERVE
        current.append(f)
        size += cost
    if current:
        groups.append(current)
    return groups


def make_zip(files: list[Path], zip_path: Path, folder_name: str) -> None:
    # Videos are already compressed, so store them as-is (much faster, same size).
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zf:
        for f in files:
            zf.write(f, arcname=f"{folder_name}/{f.name}")


def unique_path(path: Path) -> Path:
    n, candidate = 1, path
    while candidate.exists():
        candidate = path.with_name(f"{path.stem} ({n}){path.suffix}")
        n += 1
    return candidate


def main() -> int:
    parser = argparse.ArgumentParser(description="Download a YouTube playlist into a ZIP file.")
    parser.add_argument("url", nargs="?", help="Playlist link (if omitted, you will be asked for it)")
    parser.add_argument("-o", "--output-dir", default=".", help="Where to save the ZIP (default: current folder)")
    parser.add_argument("--audio", action="store_true", help="Download audio only (MP3)")
    parser.add_argument("--max-height", type=int, help="Maximum video height, e.g. 720 or 1080")
    parser.add_argument("--max-size", type=float, default=30,
                        help="Maximum size of each ZIP in MB (default: 30, 0 = one ZIP with no limit)")
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
        downloaded = len(files)

        raw_split = []
        if args.max_size > 0:
            max_bytes = int(args.max_size * MB)
            files, raw_split = fit_files(files, max_bytes, title)
            groups = group_files(files, max_bytes, title)
        else:
            groups = [files]

        if len(groups) == 1:
            zip_paths = [unique_path(out_dir / f"{title}.zip")]
            dest = out_dir
        else:
            # Several parts: keep them together in a folder named after the playlist.
            dest = unique_path(out_dir / title)
            dest.mkdir()
            width = max(2, len(str(len(groups))))
            zip_paths = [dest / f"{title} - part {i:0{width}d} of {len(groups):0{width}d}.zip"
                         for i in range(1, len(groups) + 1)]

        for group, zip_path in zip(groups, zip_paths):
            print(f"Creating {zip_path.name} ...")
            make_zip(group, zip_path, title)

    total_mb = sum(z.stat().st_size for z in zip_paths) / MB
    print(f"\nDone! {downloaded} video(s) in {len(zip_paths)} ZIP file(s), {total_mb:.1f} MB in total")
    print(f"Saved to: {zip_paths[0] if len(zip_paths) == 1 else dest}")
    if downloaded < expected:
        print(f"Note: {expected - downloaded} video(s) were skipped (private, deleted or unavailable).")
    if raw_split:
        print("\nThese files could not be cut into playable pieces (ffmpeg missing), so they were split")
        print("into raw chunks (.001, .002, ...). Extract all the chunks into one folder, then join them:")
        for f in raw_split:
            print(f'  Windows:     copy /b "{f.name}.0*" "{f.name}"')
            print(f'  Mac/Linux:   cat "{f.name}".0* > "{f.name}"')
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nCancelled.")
        sys.exit(130)
