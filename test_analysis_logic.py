
import sys
import os
import numpy as np

# Mock librosa to avoid dependency issues if environment is flaky,
# but we want to test the logic in analyzer.py
try:
    import librosa
    import analyzer
    print("Dependencies loaded.")
except ImportError as e:
    print(f"ImportError: {e}")
    sys.exit(1)

# Create a dummy audio signal (sine wave)
sr = 22050
duration = 5
t = np.linspace(0, duration, int(sr * duration))
# Create a signal with known amplitude
# 0.1 amplitude sine wave
y = 0.1 * np.sin(2 * np.pi * 440 * t)

print("Testing estimate_energy with 0.1 amplitude sine wave...")
try:
    energy = analyzer.estimate_energy(y)
    print(f"Calculated Energy: {energy}")
except Exception as e:
    print(f"Error in estimate_energy: {e}")
    import traceback
    traceback.print_exc()

# Test with silence
y_silence = np.zeros_like(t)
print("\nTesting estimate_energy with silence...")
try:
    energy_silence = analyzer.estimate_energy(y_silence)
    print(f"Calculated Energy (Silence): {energy_silence}")
except Exception as e:
    print(f"Error in estimate_energy (Silence): {e}")

# Test with loud noise
y_loud = np.random.uniform(-1, 1, len(t))
print("\nTesting estimate_energy with loud noise...")
try:
    energy_loud = analyzer.estimate_energy(y_loud)
    print(f"Calculated Energy (Loud): {energy_loud}")
except Exception as e:
    print(f"Error in estimate_energy (Loud): {e}")
