# 💀 SkullKrush Music Analyzer
> **A Product of SkullKrush Studios**

A powerful, modern tool to analyze your local music library and tag files with BPM, Key, Energy, and Spotify Metadata. It combines state-of-the-art audio analysis with the vast metadata of Spotify to give you a deeper understanding of your library.

## ✨ Features

*   **Advanced Audio Analysis**: Uses `librosa` to locally analyze your audio files and detect:
    *   **BPM (Tempo)**: Accurate beats-per-minute detection.
    *   **Key**: Musical key detection (e.g., A Major, C# Minor).
    *   **Energy**: A calculated energy score based on the audio's intensity.
*   **Smart Metadata Enrichment**: Integrates with the **Spotify API** to fetch:
    *   **Popularity**: How popular the track is globally (0-100).
    *   **Genres**: Artist genres associated with the track.
    *   **Danceability & Valence**: Spotify's proprietary mood and feel metrics.
*   **Auto-Tagging**: Automatically writes all this data back to your files (MP3, FLAC, WAV, OGG) using standard and custom tags, making it compatible with advanced music players (like Foobar2000, MusicBee, or DJ software).

## 🚀 Getting Started

### Prerequisites
*   Python 3.8+
*   [FFmpeg](https://ffmpeg.org/) (required by `librosa` for audio processing)
*   (Optional) **Spotify API Credentials** for fetching popularity/genre data.

### Installation

1.  **Clone the repository** (or navigate to the project folder):
    ```bash
    cd music-library-analyzer
    ```

2.  **Set up a virtual environment**:
    ```bash
    python3 -m venv venv
    source venv/bin/activate  # On Windows: venv\Scripts\activate
    ```

3.  **Install dependencies**:
    ```bash
    pip install -r requirements.txt
    ```

## 🔑 Spotify Configuration (Optional but Recommended)

To get **Popularity**, **Genre**, and **Mood** data, you need free Spotify API keys:
1.  Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/).
2.  Log in and click **"Create App"**.
3.  Copy the **Client ID** and **Client Secret**.

## 🎧 Usage

Run the analyzer on your music folder:

```bash
python main.py --dir "/path/to/your/music"
```

The app will automatically load your Spotify credentials from the `.env` file.

### Without Spotify Keys
If you haven't set up the `.env` file, it will **only** perform local analysis (BPM, Key, Energy):
```bash
python main.py --dir "./my_songs"
```

## 🏷️ What Tags Are Written?

| Tag Name | Description | Source |
| :--- | :--- | :--- |
| `BPM` | Beats Per Minute | Local Analysis |
| `KEY` | Musical Key | Local Analysis |
| `ENERGY` | Intensity Score | Local Analysis |
| `POPULARITY` | Spotify Popularity (0-100) | Spotify API |
| `GENRES` | Artist Genres | Spotify API |
| `DANCEABILITY` | Danceability Score | Spotify API |
| `VALENCE` | Musical Positiveness | Spotify API |

---
*Built with [Librosa](https://librosa.org/), [Spotipy](https://spotipy.readthedocs.io/), and [Mutagen](https://mutagen.readthedocs.io/).*
