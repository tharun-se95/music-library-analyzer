import numpy as np
import scipy.io.wavfile as wav

# Generate a 440 Hz sine wave (A4)
sample_rate = 44100
duration = 5 # seconds
t = np.linspace(0, duration, int(sample_rate * duration), endpoint=False)
audio = 0.5 * np.sin(2 * np.pi * 440 * t)

# Save as WAV
wav.write("test_music/test_sine.wav", sample_rate, (audio * 32767).astype(np.int16))
print("Generated test_music/test_sine.wav")
