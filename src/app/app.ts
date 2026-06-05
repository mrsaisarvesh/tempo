import {ChangeDetectionStrategy, Component, signal, computed, inject, ElementRef, ViewChild, HostListener} from '@angular/core';
import {CommonModule} from '@angular/common';
import {MatIconModule} from '@angular/material/icon';
import {AudioService, Track, Playlist} from './services/audio';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [CommonModule, MatIconModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly audioService = inject(AudioService);
  protected readonly Math = Math;

  // Layout View Tabs State
  activeTab = signal<'home' | 'library' | 'queue' | 'playlist'>('home');
  librarySubTab = signal<'songs' | 'artists' | 'albums' | 'playlists'>('songs');
  
  // Immersive now playing drawer overlay
  showNowPlayingFull = signal<boolean>(false);
  
  // Filtering & Custom Creators State
  searchQuery = signal<string>('');
  selectedPlaylistId = signal<string | null>(null);
  playlistNameInput = signal<string>('');
  trackMenuOpenId = signal<string | null>(null);

  // File picker reference for scanner imports
  @ViewChild('fileInputEl') fileInputEl!: ElementRef<HTMLInputElement>;

  // Computed: Songs filtered by Search Input query
  readonly filteredSongs = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    const tracks = this.audioService.library();
    if (!query) return tracks;
    
    return tracks.filter(
      (track) =>
        track.title.toLowerCase().includes(query) ||
        track.artist.toLowerCase().includes(query) ||
        track.album.toLowerCase().includes(query) ||
        track.genre.toLowerCase().includes(query)
    );
  });

  // Computed: Unique artists list and calculation of tracks count
  readonly artists = computed(() => {
    const tracks = this.audioService.library();
    const map = new Map<string, { name: string; count: number; cover: string }>();
    
    tracks.forEach((t) => {
      const entry = map.get(t.artist);
      if (entry) {
        entry.count++;
      } else {
        map.set(t.artist, { name: t.artist, count: 1, cover: t.coverUrl });
      }
    });

    return Array.from(map.values());
  });

  // Computed: Unique albums list and track count
  readonly albums = computed(() => {
    const tracks = this.audioService.library();
    const map = new Map<string, { title: string; artist: string; count: number; cover: string }>();
    
    tracks.forEach((t) => {
      const key = `${t.album}-${t.artist}`;
      const entry = map.get(key);
      if (entry) {
        entry.count++;
      } else {
        map.set(key, { title: t.album, artist: t.artist, count: 1, cover: t.coverUrl });
      }
    });

    return Array.from(map.values());
  });

  // Computed: Retrieve Playlist focused object
  readonly activePlaylist = computed(() => {
    const id = this.selectedPlaylistId();
    if (!id) return null;
    return this.audioService.playlists().find(p => p.id === id) || null;
  });

  // Computed: Get Track objects for the currently viewed playlist
  readonly activePlaylistTracks = computed(() => {
    const pl = this.activePlaylist();
    if (!pl) return [];
    
    const lib = this.audioService.library();
    return pl.trackIds
      .map(id => lib.find(t => t.id === id))
      .filter((t): t is Track => t !== undefined);
  });

  // Utility to handle formatting seconds -> mm:ss
  formatTime(seconds: number): string {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  // Choose display view navigation
  selectTab(tab: 'home' | 'library' | 'queue' | 'playlist') {
    this.activeTab.set(tab);
    // Auto collapse track options popover
    this.trackMenuOpenId.set(null);
  }

  // Select Library sub-section songs/artists/albums/playlists
  selectLibrarySubTab(tab: 'songs' | 'artists' | 'albums' | 'playlists') {
    this.librarySubTab.set(tab);
    this.trackMenuOpenId.set(null);
  }

  // Focused view of custom playlists
  viewPlaylist(playlistId: string) {
    this.selectedPlaylistId.set(playlistId);
    this.selectTab('playlist');
  }

  // Create custom group container
  onCreatePlaylist() {
    const name = this.playlistNameInput().trim();
    if (!name) return;
    
    const newPl = this.audioService.createPlaylist(name);
    this.playlistNameInput.set('');
    this.viewPlaylist(newPl.id);
  }

  // Delete chosen playlist entirely
  onDeletePlaylist(playlistId: string, event: Event) {
    event.stopPropagation();
    this.audioService.deletePlaylist(playlistId);
    if (this.selectedPlaylistId() === playlistId) {
      this.selectedPlaylistId.set(null);
      this.selectTab('library');
      this.librarySubTab.set('playlists');
    }
  }

  // Star / unstar favorite songs catalog
  toggleFavorite(track: Track, event: Event) {
    event.stopPropagation();
    this.audioService.toggleFavorite(track.id);
  }

  // Popover configuration for playlist adder
  toggleTrackMenu(trackId: string, event: Event) {
    event.stopPropagation();
    if (this.trackMenuOpenId() === trackId) {
      this.trackMenuOpenId.set(null);
    } else {
      this.trackMenuOpenId.set(trackId);
    }
  }

  // Append clicked song to user playlist
  addTrackToPlaylist(playlistId: string, trackId: string, event: Event) {
    event.stopPropagation();
    this.audioService.addTrackToPlaylist(playlistId, trackId);
    this.trackMenuOpenId.set(null);
  }

  // Remove song from active playlist view
  removeTrackFromPlaylist(trackId: string, event: Event) {
    event.stopPropagation();
    const pl = this.activePlaylist();
    if (pl) {
      this.audioService.removeTrackFromPlaylist(pl.id, trackId);
    }
  }

  // Add all files currently selected to library
  triggerFileSelect() {
    this.fileInputEl.nativeElement.click();
  }

  handleFileUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      for (const file of Array.from(input.files)) {
        if (file.type.startsWith('audio/')) {
          this.audioService.addLocalTrack(file);
        }
      }
      this.selectTab('library');
      this.librarySubTab.set('songs');
    }
    // reset input
    input.value = '';
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      let imported = 0;
      for (const file of Array.from(files)) {
        if (file.type.startsWith('audio/')) {
          this.audioService.addLocalTrack(file);
          imported++;
        }
      }
      if (imported > 0) {
        this.selectTab('library');
        this.librarySubTab.set('songs');
      }
    }
  }

  // Quick helper to jump slide seekbar
  onProgressBarClick(event: MouseEvent, container: HTMLDivElement) {
    const rect = container.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const width = rect.width;
    const ratio = clickX / width;
    const targetSeconds = ratio * this.audioService.duration();
    this.audioService.seek(targetSeconds);
  }

  // Volume bar click seek
  onVolumeBarClick(event: MouseEvent, container: HTMLDivElement) {
    const rect = container.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const width = rect.width;
    const volumeRatio = Math.max(0, Math.min(clickX / width, 1));
    this.audioService.setVolume(volumeRatio);
  }

  // Quick Play playlist items
  playPlaylist(playlist: Playlist) {
    const lib = this.audioService.library();
    const playlistTracks = playlist.trackIds
      .map(id => lib.find(t => t.id === id))
      .filter((t): t is Track => t !== undefined);

    if (playlistTracks.length > 0) {
      this.audioService.queue.set(playlistTracks);
      this.audioService.playTrack(playlistTracks[0]);
    }
  }

  // Directly jump play of artist collection
  playArtistTracks(artistName: string) {
    const collections = this.audioService.library().filter(t => t.artist === artistName);
    if (collections.length > 0) {
      this.audioService.queue.set(collections);
      this.audioService.playTrack(collections[0]);
    }
  }

  // Quickly load album and play
  playAlbumTracks(albumTitle: string) {
    const collections = this.audioService.library().filter(t => t.album === albumTitle);
    if (collections.length > 0) {
      this.audioService.queue.set(collections);
      this.audioService.playTrack(collections[0]);
    }
  }

  // Closes open popovers if body is clicked
  @HostListener('document:click')
  closeAllPopovers() {
    this.trackMenuOpenId.set(null);
  }
}
