import argparse
import os
import mutagen
from dotenv import load_dotenv
from analyzer import analyze_track
from metadata import MetadataFetcher
from tagger import tag_file

# Load environment variables from .env file
load_dotenv()

def get_artist_title(path):
    try:
        audio = mutagen.File(path, easy=True)
        if audio:
            artist = audio.get('artist', [None])[0]
            title = audio.get('title', [None])[0]
            return artist, title
    except Exception:
        pass
    return None, None

def main():
    parser = argparse.ArgumentParser(description="Music Library Analyzer")
    parser.add_argument("--dir", type=str, help="Directory to scan", required=True)
    parser.add_argument("--client-id", type=str, help="Spotify Client ID", default=os.getenv("SPOTIPY_CLIENT_ID"))
    parser.add_argument("--client-secret", type=str, help="Spotify Client Secret", default=os.getenv("SPOTIPY_CLIENT_SECRET"))
    args = parser.parse_args()

    print(f"Scanning directory: {args.dir}")
    
    fetcher = MetadataFetcher(args.client_id, args.client_secret)
    
    supported_exts = ('.mp3', '.flac', '.ogg', '.wav')
    
    for root, dirs, files in os.walk(args.dir):
        for file in files:
            if file.lower().endswith(supported_exts):
                path = os.path.join(root, file)
                print(f"\nProcessing: {file}")
                
                # 1. Local Analysis
                print("  Analyzing audio...")
                analysis_result = analyze_track(path)
                if not analysis_result:
                    continue
                
                print(f"  BPM: {analysis_result['bpm']}, Key: {analysis_result['key']}, Energy: {analysis_result['energy']}")
                
                # 2. Metadata Fetching
                artist, title = get_artist_title(path)
                metadata_result = {}
                if artist and title:
                    print(f"  Fetching metadata for {artist} - {title}...")
                    metadata_result = fetcher.get_track_info(artist, title)
                    if metadata_result:
                        print(f"  Found: Popularity {metadata_result['popularity']}, Genres {metadata_result['genres'][:3]}")
                    else:
                        print("  Metadata not found on Spotify.")
                else:
                    print("  Artist/Title tags missing, skipping metadata fetch.")
                
                # 3. Merge & Tag
                final_tags = {**analysis_result}
                if metadata_result:
                    final_tags.update(metadata_result)
                
                tag_file(path, final_tags)

if __name__ == "__main__":
    main()
