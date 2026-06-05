import {Injectable, signal, computed, effect} from '@angular/core';

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // in seconds
  coverUrl: string;
  genre: string;
  isFavorite?: boolean;
  synthType?: 'ambient' | 'synthwave' | 'lofi' | 'minimal';
  audioUrl?: string; // used for custom files or standard streams
  isLocal?: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: string;
}

@Injectable({
  providedIn: 'root',
})
export class AudioService {
  // Traditional Audio Elements & Synthesizer State
  private audioCtx: AudioContext | null = null;
  private synthInterval: ReturnType<typeof setInterval> | null = null;
  private audioHtml: HTMLAudioElement | null = null;
  private simulatedInterval: ReturnType<typeof setInterval> | null = null;

  // Track Definitions (Premium Preloaded Ambient Synth Tracks & User Catalog)
  private defaultTracks: Track[] = [
    {
      id: 'synth-1',
      title: 'Suborbital Drift',
      artist: 'Tempo Labs',
      album: 'Cosmic Harmonics',
      duration: 180,
      coverUrl: 'https://picsum.photos/seed/drift/600/600',
      genre: 'Ambient',
      synthType: 'ambient'
    },
    {
      id: 'synth-2',
      title: 'Retrowave Horizon',
      artist: 'Tempo Labs',
      album: 'Retroactive Waves',
      duration: 150,
      coverUrl: 'https://picsum.photos/seed/horizon/600/600',
      genre: 'Synthwave',
      synthType: 'synthwave'
    },
    {
      id: 'synth-3',
      title: 'Neon Raindrops',
      artist: 'Tempo Labs',
      album: 'Lo-Fi Chillscapes',
      duration: 160,
      coverUrl: 'https://picsum.photos/seed/raindrops/600/600',
      genre: 'Lo-Fi Chill',
      synthType: 'lofi'
    },
    {
      id: 'synth-4',
      title: 'Deep Space Pulse',
      artist: 'Tempo Labs',
      album: 'Event Horizon',
      duration: 200,
      coverUrl: 'https://picsum.photos/seed/pulse/600/600',
      genre: 'Minimal Techno',
      synthType: 'minimal'
    }
  ];

  // Core Reactive Signals
  library = signal<Track[]>([]);
  playlists = signal<Playlist[]>([]);
  
  // Queue Management Signals
  queue = signal<Track[]>([]);
  currentTrackIndex = signal<number>(-1);
  
  // Computed Signals for current item
  currentTrack = computed(() => {
    const idx = this.currentTrackIndex();
    const q = this.queue();
    if (idx >= 0 && idx < q.length) {
      return q[idx];
    }
    return null;
  });

  // State signals
  isPlaying = signal<boolean>(false);
  currentTime = signal<number>(0);
  duration = signal<number>(0);
  volume = signal<number>(0.85);
  shuffleMode = signal<boolean>(false);
  repeatMode = signal<'none' | 'all' | 'one'>('none');

  // Favorites computed
  favorites = computed(() => {
    return this.library().filter(t => t.isFavorite);
  });

  // Synthesizer Sequencer Fields
  private synthStep = 0;
  private nextSynthTime = 0;
  // Tempo BPMs for procedural synths
  private synthBPMs: Record<string, number> = {
    ambient: 68,
    synthwave: 110,
    lofi: 76,
    minimal: 122,
  };

  constructor() {
    this.loadStateFromStorage();

    // Effect to adjust playing volumes
    effect(() => {
      const vol = this.volume();
      if (this.audioHtml) {
        this.audioHtml.volume = vol;
      }
    });

      // Play State Sync effect
      effect(() => {
        const playing = this.isPlaying();
        const track = this.currentTrack();
        
        // Stop ongoing simulations
        this.stopSimulationInterval();

        if (playing && track) {
          if (!track.synthType) {
            // Normal HTML Audio File
            if (this.audioHtml) {
              this.audioHtml.play().catch(err => {
                console.log('Play interrupted or browser blocked auto-play', err);
                this.isPlaying.set(false);
              });
            }
          } else {
            // Play Synthesized procedural music
            this.resumeAudioContext();
            this.startSynthSequencer(track);
            this.startSimulationInterval();
          }
        } else {
          // Paused state
          if (this.audioHtml) {
            this.audioHtml.pause();
          }
          this.stopSynthSequencer();
        }
      });
  }

  // --- Local Storage state persistence ---
  private loadStateFromStorage() {
    let savedTracks: Track[] = [];
    let savedPlaylists: Playlist[] = [];

    if (typeof window !== 'undefined') {
      try {
        const tr = localStorage.getItem('tempo_user_library');
        if (tr) {
          savedTracks = JSON.parse(tr);
        }
        
        const pl = localStorage.getItem('tempo_user_playlists');
        if (pl) {
          savedPlaylists = JSON.parse(pl);
        }
      } catch (e) {
        console.error('Error loading Tempo local storage data:', e);
      }
    }

    // Merge default synth tracks with custom uploaded tracks
    const mergedTracks = [...this.defaultTracks];
    savedTracks.forEach((st) => {
      if (!mergedTracks.some(t => t.id === st.id)) {
        mergedTracks.push(st);
      }
    });

    this.library.set(mergedTracks);

    // If playlists are empty, bootstrap with a couple of neat ones
    if (savedPlaylists.length === 0) {
      savedPlaylists = [
        {
          id: 'pl-1',
          name: 'Cyberpunk Focus Drive',
          trackIds: ['synth-2', 'synth-4'],
          createdAt: new Date().toISOString()
        },
        {
          id: 'pl-2',
          name: 'Zen Late Night Beats',
          trackIds: ['synth-1', 'synth-3'],
          createdAt: new Date().toISOString()
        }
      ];
      this.savePlaylists(savedPlaylists);
    }
    this.playlists.set(savedPlaylists);
    
    // Set default queue
    this.queue.set([...this.defaultTracks]);
    if (this.queue().length > 0) {
      this.currentTrackIndex.set(0);
      this.duration.set(this.queue()[0].duration);
    }
  }

  private saveLibrary() {
    if (typeof window !== 'undefined') {
      try {
        // Only persist custom local user-added tracks
        const userTracks = this.library().filter(t => t.id.startsWith('usr-'));
        localStorage.setItem('tempo_user_library', JSON.stringify(userTracks));
      } catch (e) {
        console.error('Error saving library to local storage:', e);
      }
    }
  }

  private savePlaylists(plList: Playlist[]) {
    this.playlists.set(plList);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('tempo_user_playlists', JSON.stringify(plList));
      } catch (e) {
        console.error('Error saving playlists to local storage:', e);
      }
    }
  }

  // --- HTML Audio Player Helpers & Simulating Seek state ---
  private initHtmlAudioOfTrack(track: Track) {
    if (this.audioHtml) {
      this.audioHtml.pause();
      this.audioHtml = null;
    }

    if (track.audioUrl) {
      this.audioHtml = new Audio(track.audioUrl);
      this.audioHtml.volume = this.volume();
      this.duration.set(track.duration || 180);
      this.currentTime.set(0);

      this.audioHtml.addEventListener('timeupdate', () => {
        if (this.audioHtml) {
          this.currentTime.set(Math.floor(this.audioHtml.currentTime));
        }
      });

      this.audioHtml.addEventListener('loadedmetadata', () => {
        if (this.audioHtml) {
          this.duration.set(Math.floor(this.audioHtml.duration));
        }
      });

      this.audioHtml.addEventListener('ended', () => {
        this.onTrackEnded();
      });

      if (this.isPlaying()) {
        this.audioHtml.play().catch(e => console.log('Autoplay deferred until interactions', e));
      }
    }
  }

  // Simulation timer for Synthesizer playback (to update seek and timelines accurately)
  private startSimulationInterval() {
    this.stopSimulationInterval();
    this.simulatedInterval = setInterval(() => {
      const cur = this.currentTime();
      const max = this.duration();
      if (cur < max) {
        this.currentTime.set(cur + 1);
      } else {
        this.currentTime.set(max);
        this.stopSimulationInterval();
        this.onTrackEnded();
      }
    }, 1000);
  }

  private stopSimulationInterval() {
    if (this.simulatedInterval) {
      clearInterval(this.simulatedInterval);
      this.simulatedInterval = null;
    }
  }

  // Core handler when audio completes
  private onTrackEnded() {
    const repeat = this.repeatMode();
    if (repeat === 'one') {
      this.seek(0);
      // Restart plays
      const current = this.currentTrack();
      if (current) {
        if (current.synthType) {
          this.isPlaying.set(false);
          setTimeout(() => this.isPlaying.set(true), 150);
        } else if (this.audioHtml) {
          this.audioHtml.play();
        }
      }
    } else {
      this.next();
    }
  }

  // --- Browser Interactivity Web Audio Context Activation ---
  private resumeAudioContext() {
    if (typeof window === 'undefined') return;
    try {
      if (!this.audioCtx) {
        const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.audioCtx = new AudioCtxClass();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
    } catch (e) {
      console.warn('Could not launch procedural Web Audio Synth:', e);
    }
  }

  // --- Core Synthesis Engine (Procedural Music Loop Code) ---
  private startSynthSequencer(track: Track) {
    this.stopSynthSequencer();
    
    // Safety check for backend environments (SSR protection)
    if (typeof window === 'undefined' || !track.synthType) return;
    
    this.resumeAudioContext();
    if (!this.audioCtx) return;

    this.synthStep = Math.floor(this.currentTime() * (this.synthBPMs[track.synthType] / 60) * 4) % 16;
    this.nextSynthTime = this.audioCtx.currentTime;

    const lookAhead = 0.1; // 100ms
    const scheduleIntervalMs = 40; // 40ms polling

    this.synthInterval = setInterval(() => {
      if (!this.audioCtx) return;
      const bpm = this.synthBPMs[track.synthType || 'ambient'] || 80;
      const stepDuration = 60.0 / bpm / 4; // 16th note length in seconds

      while (this.nextSynthTime < this.audioCtx.currentTime + lookAhead) {
        this.scheduleSynthNotes(track.synthType || 'ambient', this.synthStep, this.nextSynthTime);
        this.synthStep = (this.synthStep + 1) % 16;
        this.nextSynthTime += stepDuration;
      }
    }, scheduleIntervalMs);
  }

  private stopSynthSequencer() {
    if (this.synthInterval) {
      clearInterval(this.synthInterval);
      this.synthInterval = null;
    }
  }

  // Sub-generator synthesizers of chords & elements
  private scheduleSynthNotes(type: 'ambient' | 'synthwave' | 'lofi' | 'minimal', step: number, time: number) {
    if (!this.audioCtx) return;
    const ctx = this.audioCtx;

    // Output Master Gain for overall volume control
    const masterGain = ctx.createGain();
    masterGain.gain.value = this.volume() * 0.35; // Avoid headphone blasting
    masterGain.connect(ctx.destination);

    // Setup scales based on tracks
    // Am, Fmaj7, Cmaj7, G chords
    const chordAm = [220, 261.63, 329.63, 392.00]; // Am7 (A3, C4, E4, G4)
    const chordF  = [174.61, 261.63, 349.23, 440.00]; // Fmaj7 (F3, C4, F4, A4)
    const chordC  = [261.63, 329.63, 392.00, 493.88]; // Cmaj7 (C4, E4, G4, B4)
    const chordG  = [196.00, 246.94, 293.66, 392.00]; // G (G3, B3, D4, G4)
    
    // Choose active chord according to sequencer bars
    const measure = Math.floor(step / 4);
    let chord = chordAm;
    let rootFreq = 55.00; // A1
    if (measure === 1) { chord = chordF; rootFreq = 43.65; } // F1
    if (measure === 2) { chord = chordC; rootFreq = 65.41; } // C2
    if (measure === 3) { chord = chordG; rootFreq = 49.00; } // G1

    if (type === 'ambient') {
      // --- SLOW SPACIOUS DRONING SCAPES ---
      // Chord drone Pad on Step 0 or 8
      if (step === 0 || step === 8) {
        chord.forEach((freq) => {
          const osc = ctx.createOscillator();
          const pGain = ctx.createGain();
          
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq / 2, time); // Lower octave pad
          
          pGain.gain.setValueAtTime(0, time);
          pGain.gain.linearRampToValueAtTime(0.08, time + 1.5);
          pGain.gain.exponentialRampToValueAtTime(0.001, time + 5.0);
          
          osc.connect(pGain);
          pGain.connect(masterGain);
          
          osc.start(time);
          osc.stop(time + 5.0);
        });
      }

      // Gentle bell melody on key steps
      const melodicSteps = [0, 3, 5, 8, 10, 13];
      if (melodicSteps.includes(step) && Math.random() < 0.6) {
        const notes = [440, 493.88, 523.25, 587.33, 659.25, 783.99]; // Pentatonic notes
        const note = notes[Math.floor(Math.random() * notes.length)] * 2; // High pitch bells

        const osc = ctx.createOscillator();
        const bGain = ctx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(note, time);
        
        bGain.gain.setValueAtTime(0, time);
        bGain.gain.linearRampToValueAtTime(0.05, time + 0.05);
        bGain.gain.exponentialRampToValueAtTime(0.001, time + 2.5);
        
        // Add a delay feedback simulation
        const delay = ctx.createDelay();
        delay.delayTime.value = 0.350;
        
        const delayGain = ctx.createGain();
        delayGain.gain.value = 0.4;
        
        osc.connect(bGain);
        bGain.connect(masterGain);
        
        bGain.connect(delay);
        delay.connect(delayGain);
        delayGain.connect(masterGain);
        delayGain.connect(delay); // Feedback feedback loop

        osc.start(time);
        osc.stop(time + 2.5);
      }
    } 
    else if (type === 'synthwave') {
      // --- RETRO PUMPING CHIPTUNE/BASS SYNTHWAVE ---
      // Heavy kick on step 0, 4, 8, 12
      if (step === 0 || step === 4 || step === 8 || step === 12) {
        this.synthKick(time, masterGain, 110);
      }

      // Snare on step 4 and 12
      if (step === 4 || step === 12) {
        this.synthSnare(time, masterGain, 0.12);
      }

      // Constant ticking hihat on off-beats
      if (step % 2 === 1) {
        this.synthHiHat(time, masterGain, 0.04);
      }

      // Rolling bassline (8th notes running roots)
      const bassOsc = ctx.createOscillator();
      const bassGain = ctx.createGain();
      
      bassOsc.type = 'sawtooth';
      bassOsc.frequency.setValueAtTime(rootFreq * 2, time); // 8th note driving bass
      
      bassGain.gain.setValueAtTime(0.05, time);
      bassGain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);

      // Low pass filter sweeps
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(450, time);
      filter.Q.setValueAtTime(4, time);

      bassOsc.connect(filter);
      filter.connect(bassGain);
      bassGain.connect(masterGain);

      bassOsc.start(time);
      bassOsc.stop(time + 0.2);

      // Cyberpunk arpeggiator on every step (triads repeating)
      const arpNoteIndex = step % chord.length;
      const arpFreq = chord[arpNoteIndex] * 2;

      const arpOsc = ctx.createOscillator();
      const arpGain = ctx.createGain();
      
      arpOsc.type = 'square';
      arpOsc.frequency.setValueAtTime(arpFreq, time);
      
      arpGain.gain.setValueAtTime(0, time);
      arpGain.gain.linearRampToValueAtTime(0.02, time + 0.02);
      arpGain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);

      const arpFilter = ctx.createBiquadFilter();
      arpFilter.type = 'lowpass';
      arpFilter.frequency.setValueAtTime(900, time);

      arpOsc.connect(arpFilter);
      arpFilter.connect(arpGain);
      arpGain.connect(masterGain);

      arpOsc.start(time);
      arpOsc.stop(time + 0.15);
    } 
    else if (type === 'lofi') {
      // --- COZY LO-FI CHILL TAPES ---
      // Soft kick on step 0, 7, 10
      if (step === 0 || step === 7 || step === 10) {
        this.synthKick(time, masterGain, 80);
      }
      
      // Soft brushed rim snare on step 4 and 12
      if (step === 4 || step === 12) {
        this.synthSnare(time, masterGain, 0.06);
      }

      // Jazz Rhodes electric chords tapped lightly
      if (step === 0 || step === 6 || step === 10) {
        chord.forEach((freq) => {
          const osc = ctx.createOscillator();
          const oscTriangle = ctx.createOscillator();
          const cGain = ctx.createGain();
          const filter = ctx.createBiquadFilter();
          
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, time);

          oscTriangle.type = 'triangle';
          oscTriangle.frequency.setValueAtTime(freq, time);
          
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(550, time); // warm low-pass Filter for Rhodes vibes
          
          cGain.gain.setValueAtTime(0, time);
          cGain.gain.linearRampToValueAtTime(0.04, time + 0.05);
          cGain.gain.exponentialRampToValueAtTime(0.001, time + 2.0);
          
          osc.connect(filter);
          oscTriangle.connect(filter);
          filter.connect(cGain);
          cGain.connect(masterGain);
          
          osc.start(time);
          oscTriangle.start(time);
          osc.stop(time + 2.0);
          oscTriangle.stop(time + 2.0);
        });
      }

      // Subtle rain sound crackle simulation (random tiny clicks)
      if (Math.random() < 0.25) {
        const crackleOsc = ctx.createOscillator();
        const crackleGain = ctx.createGain();
        crackleOsc.type = 'sine';
        crackleOsc.frequency.setValueAtTime(12000, time);
        
        crackleGain.gain.setValueAtTime(0.008, time);
        crackleGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.01);
        
        crackleOsc.connect(crackleGain);
        crackleGain.connect(masterGain);
        crackleOsc.start(time);
        crackleOsc.stop(time + 0.01);
      }
    } 
    else if (type === 'minimal') {
      // --- RAW REPTILIAN MINIMAL TECHNO ---
      // Heavy pounding subwoofer kick on steps 0, 4, 8, 12
      if (step === 0 || step === 4 || step === 8 || step === 12) {
        this.synthKick(time, masterGain, 160); // Stronger kick
      }

      // Sharp industrial hat on offbeats (2, 6, 10, 14)
      if (step === 2 || step === 6 || step === 10 || step === 14) {
        this.synthHiHat(time, masterGain, 0.09);
      }

      // Metallic minimal synth hook
      if (step === 3 || step === 8 || step === 11) {
        const rootNote = rootFreq * 4; // Mid-high bass
        const toneOsc = ctx.createOscillator();
        const tGain = ctx.createGain();
        const f = ctx.createBiquadFilter();

        toneOsc.type = 'sawtooth';
        toneOsc.frequency.setValueAtTime(rootNote, time);

        f.type = 'bandpass';
        // Interstellar sweeps
        const sweepFreq = 600 + Math.sin(time / 2) * 400;
        f.frequency.setValueAtTime(sweepFreq, time);
        f.Q.setValueAtTime(2, time);

        tGain.gain.setValueAtTime(0.04, time);
        tGain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);

        toneOsc.connect(f);
        f.connect(tGain);
        tGain.connect(masterGain);

        toneOsc.start(time);
        toneOsc.stop(time + 0.35);
      }
    }
  }

  // Common Analog Synth drum wrappers
  private synthKick(time: number, outNode: AudioNode, startPitch: number) {
    if (!this.audioCtx) return;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();

    osc.connect(gain);
    gain.connect(outNode);

    osc.frequency.setValueAtTime(startPitch, time);
    osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.2); // sweeping frequency down

    gain.gain.setValueAtTime(0.48, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.22); // short impact release

    osc.start(time);
    osc.stop(time + 0.25);
  }

  private synthSnare(time: number, outNode: AudioNode, amplitude: number) {
    if (!this.audioCtx) return;
    
    // Snare white noise simulation
    const bufferSize = this.audioCtx.sampleRate * 0.15; // 150ms noise
    const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noiseNode = this.audioCtx.createBufferSource();
    noiseNode.buffer = buffer;

    // Filter noise to sound like a snare drum skin
    const snareFilter = this.audioCtx.createBiquadFilter();
    snareFilter.type = 'bandpass';
    snareFilter.frequency.setValueAtTime(1000, time);

    const gain = this.audioCtx.createGain();
    gain.gain.setValueAtTime(amplitude, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);

    noiseNode.connect(snareFilter);
    snareFilter.connect(gain);
    gain.connect(outNode);

    noiseNode.start(time);
    noiseNode.stop(time + 0.15);
  }

  private synthHiHat(time: number, outNode: AudioNode, amplitude: number) {
    if (!this.audioCtx) return;
    
    // Very high pass noise click for hats
    const bufferSize = this.audioCtx.sampleRate * 0.05; // 50ms hi-hats
    const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.audioCtx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.audioCtx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(7000, time);

    const gain = this.audioCtx.createGain();
    gain.gain.setValueAtTime(amplitude, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(outNode);

    noise.start(time);
    noise.stop(time + 0.05);
  }

  // --- External Control Interactions & Seek Functionality ---
  seek(seconds: number) {
    const active = this.currentTrack();
    if (!active) return;
    
    // Clamp values
    const targetSec = Math.max(0, Math.min(seconds, active.duration));
    this.currentTime.set(targetSec);

    if (!active.synthType) {
      if (this.audioHtml) {
        this.audioHtml.currentTime = targetSec;
      }
    } else {
      // Re-trigger sequencer state
      if (this.isPlaying()) {
        this.startSynthSequencer(active);
      }
    }
  }

  togglePlay() {
    this.resumeAudioContext();
    this.isPlaying.update(p => !p);
  }

  playTrack(track: Track) {
    this.resumeAudioContext();
    
    // Find if track is currently in our playback queue
    const q = this.queue();
    let idx = q.findIndex(t => t.id === track.id);
    if (idx === -1) {
      // Add immediately to queue next to the current index
      const currIdx = this.currentTrackIndex();
      const updatedQueue = [...q];
      updatedQueue.splice(currIdx + 1, 0, track);
      this.queue.set(updatedQueue);
      idx = currIdx + 1;
    }

    this.isPlaying.set(false);
    this.currentTime.set(0);
    this.currentTrackIndex.set(idx);
    this.duration.set(track.duration);

    setTimeout(() => {
      if (!track.synthType) {
        this.initHtmlAudioOfTrack(track);
      }
      this.isPlaying.set(true);
    }, 100);
  }

  next() {
    const q = this.queue();
    if (q.length === 0) return;

    let targetIdx = this.currentTrackIndex() + 1;
    
    if (this.shuffleMode()) {
      targetIdx = Math.floor(Math.random() * q.length);
    } else if (targetIdx >= q.length) {
      if (this.repeatMode() === 'all') {
        targetIdx = 0;
      } else {
        // Stop playing at end
        this.isPlaying.set(false);
        this.currentTime.set(0);
        return;
      }
    }

    const nextTrack = q[targetIdx];
    this.playTrack(nextTrack);
  }

  previous() {
    // If song is past 3 seconds, restart the song
    if (this.currentTime() > 3) {
      this.seek(0);
      return;
    }

    const q = this.queue();
    if (q.length === 0) return;

    let targetIdx = this.currentTrackIndex() - 1;
    if (targetIdx < 0) {
      if (this.repeatMode() === 'all') {
        targetIdx = q.length - 1;
      } else {
        // Restart at index 0
        this.seek(0);
        return;
      }
    }

    const prevTrack = q[targetIdx];
    this.playTrack(prevTrack);
  }

  // Set Sound volume (0 to 1)
  setVolume(v: number) {
    const clamped = Math.max(0, Math.min(v, 1));
    this.volume.set(clamped);
  }

  // Toggle dynamic random mix play
  toggleShuffle() {
    this.shuffleMode.update(s => !s);
  }

  // Cycle repeat states
  cycleRepeat() {
    this.repeatMode.update((current) => {
      if (current === 'none') return 'all';
      if (current === 'all') return 'one';
      return 'none';
    });
  }

  // Toggle Favorited Star configuration
  toggleFavorite(trackId: string) {
    const updated = this.library().map((track) => {
      if (track.id === trackId) {
        return { ...track, isFavorite: !track.isFavorite };
      }
      return track;
    });
    this.library.set(updated);
    this.saveLibrary();
    
    // Sync current queue objects as well
    const updatedQueue = this.queue().map((qTrack) => {
      if (qTrack.id === trackId) {
        return { ...qTrack, isFavorite: !qTrack.isFavorite };
      }
      return qTrack;
    });
    this.queue.set(updatedQueue);
  }

  // --- Dynamic Live Queue Adjustments ---
  addToQueue(track: Track) {
    const current = this.queue();
    if (current.some(t => t.id === track.id)) return; // Prevent duplicate queues
    this.queue.set([...current, track]);
  }

  removeFromQueue(trackId: string) {
    const currTrack = this.currentTrack();
    const filtered = this.queue().filter(t => t.id !== trackId);
    
    this.queue.set(filtered);

    // Readjust active playing indices
    if (currTrack) {
      const freshIndex = filtered.findIndex(t => t.id === currTrack.id);
      this.currentTrackIndex.set(freshIndex);
    } else {
      this.currentTrackIndex.set(-1);
    }
  }

  clearQueue() {
    this.isPlaying.set(false);
    this.queue.set([]);
    this.currentTrackIndex.set(-1);
    this.currentTime.set(0);
  }

  // --- Customized User Playlists Management CRUD ---
  createPlaylist(name: string) {
    const id = 'pl-' + Date.now().toString(36);
    const newPlaylist: Playlist = {
      id,
      name,
      trackIds: [],
      createdAt: new Date().toISOString()
    };
    
    this.savePlaylists([...this.playlists(), newPlaylist]);
    return newPlaylist;
  }

  deletePlaylist(playlistId: string) {
    const remaining = this.playlists().filter(p => p.id !== playlistId);
    this.savePlaylists(remaining);
  }

  addTrackToPlaylist(playlistId: string, trackId: string) {
    const updated = this.playlists().map((pl) => {
      if (pl.id === playlistId) {
        if (pl.trackIds.includes(trackId)) return pl; // Avoid duplication
        return { ...pl, trackIds: [...pl.trackIds, trackId] };
      }
      return pl;
    });
    this.savePlaylists(updated);
  }

  removeTrackFromPlaylist(playlistId: string, trackId: string) {
    const updated = this.playlists().map((pl) => {
      if (pl.id === playlistId) {
        return { ...pl, trackIds: pl.trackIds.filter(id => id !== trackId) };
      }
      return pl;
    });
    this.savePlaylists(updated);
  }

  // --- Scanner Local Device Audio Upload Simulator ---
  // Users load their own physical file or device audio files
  addLocalTrack(file: File) {
    const id = 'usr-' + Date.now().toString() + '-' + Math.random().toString(36).substr(2, 4);
    const title = file.name.replace(/\.[^/.]+$/, ""); // Strip file extension
    
    // Cover generator - pick an attractive random Picsum image seed
    const coverUrl = `https://picsum.photos/seed/${id}/600/600`;
    
    // File binary URL representing physical browser play link
    const audioUrl = URL.createObjectURL(file);

    // Guess a genre randomly
    const genres = ['Electronic', 'Rhythm & Blues', 'Pop Ambient', 'Beats Indie'];
    const genre = genres[Math.floor(Math.random() * genres.length)];

    // Create custom user track entry
    const newTrack: Track = {
      id,
      title,
      artist: 'Unrecognized Device Artist',
      album: 'Imported Media Library',
      duration: 180, // Default duration placeholder, will adjust once played
      coverUrl,
      audioUrl,
      genre,
      isLocal: true
    };

    // Append to actual current state catalog
    this.library.set([...this.library(), newTrack]);
    this.saveLibrary();

    // Re-verify queue to include this
    this.addToQueue(newTrack);
    return newTrack;
  }
}
