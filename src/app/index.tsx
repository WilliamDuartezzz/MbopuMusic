import { FontAwesome } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { configureGoogle, signInWithGoogle, signOutGoogle } from '@/auth/google';
import { DriveItem, getFolderContents, getRootFolders } from '@/services/drive';
import { pauseAudio, playDriveAudio, resumeAudio, seekAudio } from '@/services/player';
import { SeekBar } from '../components/SeekBar';

configureGoogle();

const STORAGE_KEY_LIBRARIES = 'mbopu_saved_libraries';
const STORAGE_KEY_PLAYLISTS = 'mbopu_saved_playlists';

type SortType = 'name' | 'number' | 'date';
type NavHistory = { id: string; name: string };
type TabType = 'home' | 'playlists';

export type Playlist = {
  id: string;
  name: string;
  songs: DriveItem[];
};

export default function HomeScreen() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSongId, setLoadingSongId] = useState<string | null>(null);

  // Navegación principal por Pestañas (Home / Playlists)
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const [viewMode, setViewMode] = useState<'library' | 'picker'>('library');
  const [isFullPlayerVisible, setIsFullPlayerVisible] = useState(false);

  // Modales de Playlist y Favoritos
  const [isPlaylistModalVisible, setIsPlaylistModalVisible] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [selectedPlaylistView, setSelectedPlaylistView] = useState<Playlist | null>(null);

  // Playlists y Favoritos
  const [playlists, setPlaylists] = useState<Playlist[]>([
    { id: 'favorites', name: 'Favoritos ❤️', songs: [] }
  ]);

  // Estados de Reproducción
  const [isShuffle, setIsShuffle] = useState(false);

  // Selector múltiple
  const [pickerTab, setPickerTab] = useState<'my-drive' | 'shared'>('my-drive');
  const [availableFolders, setAvailableFolders] = useState<DriveItem[]>([]);
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const [savedLibraries, setSavedLibraries] = useState<DriveItem[]>([]);

  // Navegación por carpetas
  const [currentFolder, setCurrentFolder] = useState<NavHistory | null>(null);
  const [folderHistory, setFolderHistory] = useState<NavHistory[]>([]);
  const [folderItems, setFolderItems] = useState<DriveItem[]>([]);
  const [sortBy, setSortBy] = useState<SortType>('number');

  // Reproductor
  const [currentSong, setCurrentSong] = useState<DriveItem | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [currentFolderSongs, setCurrentFolderSongs] = useState<DriveItem[]>([]);
  const [siblingSubfolders, setSiblingSubfolders] = useState<DriveItem[]>([]);

  const playNextRef = useRef<() => void>(() => {});
  const isChangingSongRef = useRef(false);

  useEffect(() => {
    loadSavedLibraries();
    loadPlaylists();
  }, []);

  useEffect(() => {
    playNextRef.current = playNextSong;
  });

  async function loadSavedLibraries() {
    try {
      const json = await SecureStore.getItemAsync(STORAGE_KEY_LIBRARIES);
      if (json) setSavedLibraries(JSON.parse(json));
    } catch (e) {}
  }

  async function persistLibraries(libraries: DriveItem[]) {
    try {
      await SecureStore.setItemAsync(STORAGE_KEY_LIBRARIES, JSON.stringify(libraries));
    } catch (e) {}
  }

  async function loadPlaylists() {
    try {
      const json = await SecureStore.getItemAsync(STORAGE_KEY_PLAYLISTS);
      if (json) {
        setPlaylists(JSON.parse(json));
      }
    } catch (e) {}
  }

  async function persistPlaylists(updatedPlaylists: Playlist[]) {
    try {
      setPlaylists(updatedPlaylists);
      await SecureStore.setItemAsync(STORAGE_KEY_PLAYLISTS, JSON.stringify(updatedPlaylists));
    } catch (e) {}
  }

  function isSongInPlaylist(playlistId: string, songId: string) {
    const pl = playlists.find(p => p.id === playlistId);
    if (!pl) return false;
    return pl.songs.some(s => s.id === songId);
  }

  function toggleSongInPlaylist(playlistId: string) {
    if (!currentSong) return;

    const updated = playlists.map(pl => {
      if (pl.id === playlistId) {
        const exists = pl.songs.some(s => s.id === currentSong.id);
        const newSongs = exists
          ? pl.songs.filter(s => s.id !== currentSong.id)
          : [...pl.songs, currentSong];
        return { ...pl, songs: newSongs };
      }
      return pl;
    });

    persistPlaylists(updated);
  }

  function createNewPlaylist() {
    if (!newPlaylistName.trim()) return;
    const newPl: Playlist = {
      id: Date.now().toString(),
      name: newPlaylistName.trim(),
      songs: currentSong ? [currentSong] : []
    };

    const updated = [...playlists, newPl];
    persistPlaylists(updated);
    setNewPlaylistName('');
  }

  async function onSignIn() {
    setLoading(true);
    try {
      const u = await signInWithGoogle();
      if (u) setUser(u);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Fallo al iniciar sesión');
    } finally {
      setLoading(false);
    }
  }

  async function openFolderPicker(source: 'my-drive' | 'shared' = 'my-drive') {
    setLoading(true);
    setPickerTab(source);
    setViewMode('picker');
    try {
      const folders = await getRootFolders(source);
      setAvailableFolders(folders);
    } catch (e: any) {
      Alert.alert('Error al leer Drive', e?.message ?? 'Revisa tu conexión');
    } finally {
      setLoading(false);
    }
  }

  function toggleFolderSelection(folder: DriveItem) {
    if (selectedFolderIds.includes(folder.id)) {
      setSelectedFolderIds(prev => prev.filter(id => id !== folder.id));
    } else {
      setSelectedFolderIds(prev => [...prev, folder.id]);
    }
  }

  function confirmSelectedFolders() {
    const chosen = availableFolders.filter(f => selectedFolderIds.includes(f.id));
    const updated = [...savedLibraries];
    chosen.forEach(item => {
      if (!updated.some(u => u.id === item.id)) updated.push(item);
    });
    setSavedLibraries(updated);
    persistLibraries(updated);
    setViewMode('library');
  }

  function sortItems(list: DriveItem[], criteria: SortType): DriveItem[] {
    const folders = list.filter(i => i.isFolder);
    const songs = list.filter(i => !i.isFolder);

    songs.sort((a, b) => {
      if (criteria === 'name') return a.name.localeCompare(b.name);
      if (criteria === 'number') {
        const numA = parseInt(a.name.match(/\d+/)?.[0] || '9999', 10);
        const numB = parseInt(b.name.match(/\d+/)?.[0] || '9999', 10);
        return numA !== numB ? numA - numB : a.name.localeCompare(b.name);
      }
      if (criteria === 'date') {
        const dateA = new Date(a.modifiedTime || 0).getTime();
        const dateB = new Date(b.modifiedTime || 0).getTime();
        return dateB - dateA;
      }
      return 0;
    });

    return [...folders, ...songs];
  }

  function changeSortMode() {
    const modes: SortType[] = ['number', 'name', 'date'];
    const next = modes[(modes.indexOf(sortBy) + 1) % modes.length];
    setSortBy(next);
    setFolderItems(prev => sortItems(prev, next));
  }

  async function loadFolder(folder: NavHistory): Promise<boolean> {
    setLoading(true);
    try {
      const contents = await getFolderContents(folder.id);
      const sorted = sortItems(contents, sortBy);
      setCurrentFolder(folder);
      setFolderItems(sorted);
      setCurrentFolderSongs(sorted.filter(i => !i.isFolder));
      setSiblingSubfolders(sorted.filter(i => i.isFolder));
      return true;
    } catch (e: any) {
      Alert.alert('Error', 'No se pudo abrir esta carpeta.');
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function enterFolder(folder: DriveItem) {
    const from = currentFolder;
    const ok = await loadFolder({ id: folder.id, name: folder.name });
    if (ok && from) setFolderHistory(prev => [...prev, from]);
  }

  function goBack() {
    if (folderHistory.length === 0) {
      setCurrentFolder(null);
      setFolderItems([]);
      return;
    }
    const prev = [...folderHistory];
    const target = prev.pop()!;
    setFolderHistory(prev);
    loadFolder(target);
  }

  async function startPlaying(song: DriveItem, customQueue?: DriveItem[]) {
    setCurrentSong(song);
    setLoadingSongId(song.id);
    setIsPlaying(true);
    setPlaybackPosition(0);
    isChangingSongRef.current = false;

    if (customQueue && customQueue.length > 0) {
      setCurrentFolderSongs(customQueue);
    }

    try {
      await playDriveAudio(song.id, song.name, (status: any) => {
        if (status.isLoaded) {
          setLoadingSongId(null);
          setPlaybackPosition((status.currentTime || 0) * 1000);
          setPlaybackDuration((status.duration || 1) * 1000);
          
          if ((status.playbackState === 'ended' || status.didJustFinish) && !isChangingSongRef.current) {
            isChangingSongRef.current = true;
            playNextRef.current();
          }
        }
      });
    } catch (e: any) {
      setLoadingSongId(null);
      Alert.alert('Error', e?.message ?? 'Fallo al reproducir');
    }
  }

  function handleSeek(fraction: number) {
    if (!playbackDuration) return;
    const targetMs = fraction * playbackDuration;
    setPlaybackPosition(targetMs);
    seekAudio(targetMs / 1000);
  }

  function togglePlayPause() {
    if (isPlaying) {
      pauseAudio();
      setIsPlaying(false);
    } else {
      resumeAudio();
      setIsPlaying(true);
    }
  }

  async function playNextSong() {
    if (!currentSong || currentFolderSongs.length === 0) return;

    if (isShuffle) {
      if (currentFolderSongs.length === 1) {
        startPlaying(currentFolderSongs[0], currentFolderSongs);
        return;
      }
      let randomIndex;
      do {
        randomIndex = Math.floor(Math.random() * currentFolderSongs.length);
      } while (currentFolderSongs[randomIndex].id === currentSong.id);
      
      startPlaying(currentFolderSongs[randomIndex], currentFolderSongs);
      return;
    }

    const currentIndex = currentFolderSongs.findIndex(s => s.id === currentSong.id);
    if (currentIndex !== -1 && currentIndex < currentFolderSongs.length - 1) {
      startPlaying(currentFolderSongs[currentIndex + 1], currentFolderSongs);
      return;
    }

    startPlaying(currentFolderSongs[0], currentFolderSongs);
  }

  function playPreviousSong() {
    if (!currentSong || currentFolderSongs.length === 0) return;
    const currentIndex = currentFolderSongs.findIndex(s => s.id === currentSong.id);
    if (currentIndex > 0) {
      startPlaying(currentFolderSongs[currentIndex - 1], currentFolderSongs);
    } else {
      startPlaying(currentFolderSongs[currentFolderSongs.length - 1], currentFolderSongs);
    }
  }

  function toggleShuffle() {
    setIsShuffle(!isShuffle);
  }

  function formatMillis(millis: number) {
    const totalSeconds = Math.floor(millis / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }

  async function onSignOut() {
    await signOutGoogle();
    setUser(null);
    setSavedLibraries([]);
    setCurrentFolder(null);
    setFolderHistory([]);
    setCurrentSong(null);
    setIsFullPlayerVisible(false);
  }

  const progress = playbackPosition / (playbackDuration || 1);
  const isCurrentSongFavorite = currentSong ? isSongInPlaylist('favorites', currentSong.id) : false;

  return (
    <View style={styles.mainContainer}>
      <View style={styles.glowCircle1} />
      <View style={styles.glowCircle2} />

      <SafeAreaView style={styles.safeArea}>
        {/* Cabecera */}
        <View style={styles.glassHeader}>
          <View style={styles.headerContent}>
            <View>
              <Text style={styles.title}>MbopuMusic</Text>
              <Text style={styles.subtextHeader}>{user ? user.email : 'Cloud Music Player'}</Text>
            </View>
            {user && (
              <Pressable onPress={onSignOut} style={styles.logoutBtn}>
                <Text style={styles.logoutText}>Salir</Text>
              </Pressable>
            )}
          </View>
        </View>

        {!user ? (
          <View style={styles.centerContainer}>
            <View style={styles.glassCardWelcome}>
              <FontAwesome name="music" size={44} color="#1E78FF" style={{ marginBottom: 12 }} />
              <Text style={styles.welcomeTitle}>MbopuMusic</Text>
              <Text style={styles.welcomeSubtitle}>
                Tus carpetas de Google Drive convertidas en un reproductor de música sin muros de pago.
              </Text>
              <Pressable onPress={onSignIn} disabled={loading} style={styles.solidButton}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Conectar con Google Drive</Text>}
              </Pressable>
            </View>
          </View>
        ) : activeTab === 'playlists' ? (
          /* --- SECCIÓN DE PLAYLISTS --- */
          <View style={styles.wrapper}>
            {selectedPlaylistView ? (
              <View style={{ flex: 1 }}>
                <View style={styles.navBar}>
                  <Pressable onPress={() => setSelectedPlaylistView(null)} style={styles.backBtn}>
                    <Text style={styles.backBtnText}>‹ Volver</Text>
                  </Pressable>
                  <Text style={styles.navTitle} numberOfLines={1}>🎵 {selectedPlaylistView.name}</Text>
                </View>

                <FlatList
                  data={selectedPlaylistView.songs}
                  keyExtractor={i => i.id}
                  ListEmptyComponent={<Text style={styles.emptyText}>Playlist vacía</Text>}
                  renderItem={({ item }) => {
                    const isCurrent = currentSong?.id === item.id;
                    return (
                      <Pressable
                        style={[styles.glassRow, isCurrent && { borderColor: '#00E676', backgroundColor: 'rgba(0, 230, 118, 0.08)' }]}
                        onPress={() => startPlaying(item, selectedPlaylistView.songs)}>
                        <View style={styles.iconContainer}>
                          <FontAwesome name="music" size={20} color="#00E676" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.rowText, isCurrent && { color: '#00E676', fontWeight: 'bold' }]} numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text style={styles.songHint}>
                            {isCurrent && isPlaying ? 'Reproduciendo 🔊' : 'Toca para reproducir'}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  }}
                />
              </View>
            ) : (
              <View style={{ flex: 1 }}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>Tus Playlists:</Text>
                </View>

                <FlatList
                  data={playlists}
                  keyExtractor={i => i.id}
                  renderItem={({ item }) => (
                    <Pressable style={styles.glassRow} onPress={() => setSelectedPlaylistView(item)}>
                      <FontAwesome 
                        name={item.id === 'favorites' ? "heart" : "list-ul"} 
                        size={22} 
                        color={item.id === 'favorites' ? "#FF4B4B" : "#1E78FF"} 
                        style={{ marginRight: 14, marginLeft: 2 }} 
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowText} numberOfLines={1}>{item.name}</Text>
                        <Text style={styles.songHint}>{item.songs.length} canciones</Text>
                      </View>
                      <Text style={styles.chevron}>›</Text>
                    </Pressable>
                  )}
                />
              </View>
            )}
          </View>
        ) : viewMode === 'picker' ? (
          /* --- SELECTOR DE CARPETAS --- */
          <View style={styles.wrapper}>
            <Text style={styles.sectionTitle}>Marca las carpetas que quieres agregar:</Text>
            <View style={styles.tabContainer}>
              <Pressable onPress={() => openFolderPicker('my-drive')} style={[styles.tabButton, pickerTab === 'my-drive' && styles.tabButtonActive]}>
                <Text style={[styles.tabText, pickerTab === 'my-drive' && styles.tabTextActive]}>Mi Unidad</Text>
              </Pressable>
              <Pressable onPress={() => openFolderPicker('shared')} style={[styles.tabButton, pickerTab === 'shared' && styles.tabButtonActive]}>
                <Text style={[styles.tabText, pickerTab === 'shared' && styles.tabTextActive]}>Compartidos 🤝</Text>
              </Pressable>
            </View>

            {loading ? (
              <ActivityIndicator size="large" color="#4DA3FF" style={{ marginTop: 30 }} />
            ) : (
              <FlatList
                data={availableFolders}
                keyExtractor={i => i.id}
                renderItem={({ item }) => {
                  const isChecked = selectedFolderIds.includes(item.id);
                  return (
                    <Pressable style={[styles.glassRow, isChecked && styles.glassRowSelected]} onPress={() => toggleFolderSelection(item)}>
                      <FontAwesome name="folder-open" size={20} color="#1E78FF" style={{ marginRight: 12 }} />
                      <Text style={styles.rowText} numberOfLines={1}>{item.name}</Text>
                      <Text style={[styles.checkbox, isChecked && styles.checkboxActive]}>{isChecked ? '✓' : '○'}</Text>
                    </Pressable>
                  );
                }}
              />
            )}

            <View style={styles.bottomActions}>
              <Pressable onPress={() => setViewMode('library')} style={[styles.actionBtn, { backgroundColor: '#333' }]}>
                <Text style={styles.btnText}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={confirmSelectedFolders} style={[styles.actionBtn, { backgroundColor: '#1E78FF' }]}>
                <Text style={styles.btnText}>Guardar ({selectedFolderIds.length})</Text>
              </Pressable>
            </View>
          </View>
        ) : currentFolder ? (
          /* --- VISTA DENTRO DE CARPETA --- */
          <View style={styles.wrapper}>
            <View style={styles.navBar}>
              <Pressable onPress={goBack} style={styles.backBtn}>
                <Text style={styles.backBtnText}>‹ Volver</Text>
              </Pressable>
              <Text style={styles.navTitle} numberOfLines={1}>📁 {currentFolder.name}</Text>

              <Pressable onPress={changeSortMode} style={styles.sortButton}>
                <Text style={styles.sortButtonText}>
                  {sortBy === 'number' ? '🔢 Nº' : sortBy === 'name' ? '🔤 A-Z' : '📅 Fecha'}
                </Text>
              </Pressable>
            </View>

            {loading ? (
              <ActivityIndicator size="large" color="#4DA3FF" style={{ marginTop: 30 }} />
            ) : (
              <FlatList
                data={folderItems}
                keyExtractor={i => i.id}
                ListEmptyComponent={<Text style={styles.emptyText}>Carpeta vacía</Text>}
                renderItem={({ item }) => {
                  const isCurrent = currentSong?.id === item.id;
                  const isThisLoading = loadingSongId === item.id;

                  return (
                    <Pressable
                      style={[styles.glassRow, isCurrent && { borderColor: '#00E676', backgroundColor: 'rgba(0, 230, 118, 0.08)' }]}
                      onPress={() => item.isFolder ? enterFolder(item) : startPlaying(item, currentFolderSongs)}>

                      <View style={styles.iconContainer}>
                        {isThisLoading ? (
                          <ActivityIndicator size="small" color="#00E676" />
                        ) : item.isFolder ? (
                          <FontAwesome name="folder" size={22} color="#88A2C7" />
                        ) : (
                          <FontAwesome name="music" size={20} color="#00E676" />
                        )}
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text style={[styles.rowText, isCurrent && { color: '#00E676', fontWeight: 'bold' }]} numberOfLines={1}>
                          {item.name}
                        </Text>
                        {!item.isFolder && (
                          <Text style={styles.songHint}>
                            {isCurrent && isPlaying ? 'Reproduciendo 🔊' : 'Toca para reproducir'}
                          </Text>
                        )}
                      </View>
                      {item.isFolder && <Text style={styles.chevron}>›</Text>}
                    </Pressable>
                  );
                }}
              />
            )}
          </View>
        ) : (
          /* --- VISTA PRINCIPAL DE CARPETAS (HOME) --- */
          <View style={styles.wrapper}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Tus Carpetas:</Text>
              <Pressable onPress={() => openFolderPicker('my-drive')} style={styles.addBtn}>
                <FontAwesome name="plus" size={14} color="#fff" style={{ marginRight: 6 }} />
                <Text style={styles.addBtnText}>Agregar Carpetas</Text>
              </Pressable>
            </View>

            <FlatList
              data={savedLibraries}
              keyExtractor={i => i.id}
              ListEmptyComponent={
                <View style={styles.emptyCard}>
                  <FontAwesome name="folder-open-o" size={48} color="#88A2C7" style={{ marginBottom: 12 }} />
                  <Text style={styles.emptyTitle}>No tienes carpetas añadidas</Text>
                  <Text style={styles.emptySub}>Toca en "Agregar Carpetas" para elegir tus carpetas de música de Google Drive.</Text>
                </View>
              }
              renderItem={({ item }) => (
                <Pressable style={styles.glassRow} onPress={() => enterFolder(item)}>
                  <FontAwesome name="folder" size={22} color="#1E78FF" style={{ marginRight: 12 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowText} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.songHint}>Explorar subcarpetas y canciones ›</Text>
                  </View>
                </Pressable>
              )}
            />
          </View>
        )}

        {/* 1. MINI REPRODUCTOR INFERIOR */}
        {user && currentSong && (
          <Pressable onPress={() => setIsFullPlayerVisible(true)} style={styles.miniPlayer}>
            <SeekBar progress={progress} onSeek={handleSeek} touchPad={6} />

            <View style={styles.playerControlsRow}>
              <FontAwesome name="music" size={20} color="#00E676" style={{ marginRight: 10, marginLeft: 4 }} />

              <View style={{ flex: 1, paddingRight: 6, paddingLeft: 4 }}>
                <Text style={styles.playerSongTitle} numberOfLines={1}>{currentSong.name}</Text>
                <Text style={styles.playerFolderHint} numberOfLines={1}>
                  {formatMillis(playbackPosition)} / {formatMillis(playbackDuration)} · {currentFolder?.name ?? 'Carpeta'}
                </Text>
              </View>

              <Pressable onPress={playPreviousSong} style={styles.playerIconBtn}>
                <FontAwesome name="backward" size={18} color="#FFF" />
              </Pressable>
              
              <Pressable onPress={togglePlayPause} style={styles.playPauseBtn}>
                <FontAwesome name={isPlaying ? "pause" : "play"} size={14} color="#fff" />
              </Pressable>
              
              <Pressable onPress={() => playNextRef.current()} style={styles.playerIconBtn}>
                <FontAwesome name="forward" size={18} color="#FFF" />
              </Pressable>
            </View>
          </Pressable>
        )}

        {/* 2. BARRA DE NAVEGACIÓN INFERIOR (TABBAR) */}
        {user && (
          <View style={styles.tabBarContainer}>
            <Pressable 
              onPress={() => { setSelectedPlaylistView(null); setActiveTab('home'); }} 
              style={[styles.tabBarItem, activeTab === 'home' && styles.tabBarItemActive]}>
              <FontAwesome name="home" size={22} color={activeTab === 'home' ? '#1E78FF' : '#6882A6'} />
              <Text style={[styles.tabBarLabel, activeTab === 'home' && styles.tabBarLabelActive]}>Inicio</Text>
            </Pressable>

            <Pressable 
              onPress={() => setActiveTab('playlists')} 
              style={[styles.tabBarItem, activeTab === 'playlists' && styles.tabBarItemActive]}>
              <FontAwesome name="list-ul" size={20} color={activeTab === 'playlists' ? '#1E78FF' : '#6882A6'} />
              <Text style={[styles.tabBarLabel, activeTab === 'playlists' && styles.tabBarLabelActive]}>Playlists</Text>
            </Pressable>
          </View>
        )}

        {/* 3. REPRODUCTOR COMPLETO */}
        <Modal
          visible={isFullPlayerVisible}
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={() => setIsFullPlayerVisible(false)}>
          <View style={styles.fullPlayerContainer}>
            <SafeAreaView style={styles.fullPlayerSafe}>
              <View style={styles.fullPlayerHeader}>
                <Pressable onPress={() => setIsFullPlayerVisible(false)} style={styles.fullPlayerCloseBtn}>
                  <Text style={styles.fullPlayerCloseText}>⌄</Text>
                </Pressable>
                <View style={{ alignItems: 'center' }}>
                  <Text style={styles.fullPlayerHeaderSub}>REPRODUCIENDO DESDE</Text>
                  <Text style={styles.fullPlayerHeaderTitle} numberOfLines={1}>📁 {currentFolder?.name ?? 'Drive'}</Text>
                </View>
                <View style={{ width: 40 }} />
              </View>

              <View style={styles.fullArtContainer}>
                <View style={styles.vinylFull}>
                  <View style={styles.vinylGroove1}>
                    <View style={styles.vinylGroove2}>
                      <View style={styles.vinylCenterFull}>
                        <FontAwesome name="music" size={40} color="#fff" />
                      </View>
                    </View>
                  </View>
                </View>
              </View>

              <View style={styles.fullSongInfo}>
                <Text style={styles.fullSongTitle} numberOfLines={2}>{currentSong?.name}</Text>
                <Text style={styles.fullFolderSub}>{currentFolder?.name}</Text>
              </View>

              <View style={styles.fullProgressContainer}>
                <SeekBar progress={progress} onSeek={handleSeek} touchPad={14} />
                <View style={styles.fullTimeRow}>
                  <Text style={styles.fullTimeText}>{formatMillis(playbackPosition)}</Text>
                  <Text style={styles.fullTimeText}>{formatMillis(playbackDuration)}</Text>
                </View>
              </View>

              {/* CONTROLES COMPLETOS */}
              <View style={styles.fullControlsRow}>
                {/* BOTÓN DE CORAZÓN */}
                <Pressable onPress={() => setIsPlaylistModalVisible(true)} style={styles.fullSideControlBtn}>
                  <FontAwesome 
                    name={isCurrentSongFavorite ? "heart" : "heart-o"} 
                    size={22} 
                    color={isCurrentSongFavorite ? "#FF4B4B" : "#FFF"} 
                  />
                </Pressable>

                <Pressable onPress={playPreviousSong} style={styles.fullSideControlBtn}>
                  <FontAwesome name="backward" size={24} color="#FFF" />
                </Pressable>

                <Pressable onPress={togglePlayPause} style={styles.fullPlayBtn}>
                  <FontAwesome name={isPlaying ? "pause" : "play"} size={24} color="#fff" />
                </Pressable>

                <Pressable onPress={() => playNextRef.current()} style={styles.fullSideControlBtn}>
                  <FontAwesome name="forward" size={24} color="#FFF" />
                </Pressable>

                <Pressable onPress={toggleShuffle} style={styles.fullSideControlBtn}>
                  <FontAwesome name="random" size={20} color={isShuffle ? '#00E676' : '#6882A6'} />
                </Pressable>
              </View>
            </SafeAreaView>
          </View>
        </Modal>

        {/* 4. MODAL / POP-UP PARA AÑADIR A PLAYLISTS */}
        <Modal
          visible={isPlaylistModalVisible}
          animationType="fade"
          transparent={true}
          onRequestClose={() => setIsPlaylistModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Añadir a Playlist</Text>
              <Text style={styles.modalSub} numberOfLines={1}>{currentSong?.name}</Text>

              <FlatList
                data={playlists}
                keyExtractor={i => i.id}
                style={{ maxHeight: 200, marginVertical: 10 }}
                renderItem={({ item }) => {
                  const inThis = currentSong ? isSongInPlaylist(item.id, currentSong.id) : false;
                  return (
                    <Pressable 
                      style={styles.modalRow} 
                      onPress={() => toggleSongInPlaylist(item.id)}>
                      <FontAwesome 
                        name={item.id === 'favorites' ? "heart" : "list-ul"} 
                        size={18} 
                        color={item.id === 'favorites' ? "#FF4B4B" : "#1E78FF"} 
                        style={{ marginRight: 10 }}
                      />
                      <Text style={styles.modalRowText} numberOfLines={1}>{item.name}</Text>
                      <Text style={[styles.checkbox, inThis && styles.checkboxActive]}>
                        {inThis ? '✓' : '○'}
                      </Text>
                    </Pressable>
                  );
                }}
              />

              <View style={styles.newPlaylistContainer}>
                <TextInput
                  style={styles.inputNewPlaylist}
                  placeholder="Nueva playlist..."
                  placeholderTextColor="#6882A6"
                  value={newPlaylistName}
                  onChangeText={setNewPlaylistName}
                />
                <Pressable onPress={createNewPlaylist} style={styles.createPlBtn}>
                  <Text style={styles.createPlText}>Crear</Text>
                </Pressable>
              </View>

              <Pressable 
                onPress={() => setIsPlaylistModalVisible(false)} 
                style={styles.closeModalBtn}>
                <Text style={styles.closeModalText}>Hecho</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  mainContainer: { flex: 1, backgroundColor: '#040B18' },
  safeArea: { flex: 1 },
  glowCircle1: { position: 'absolute', top: -50, right: -50, width: 280, height: 280, borderRadius: 140, backgroundColor: '#0D47A1', opacity: 0.45 },
  glowCircle2: { position: 'absolute', bottom: 50, left: -60, width: 300, height: 300, borderRadius: 150, backgroundColor: '#0052D4', opacity: 0.35 },

  glassHeader: { marginHorizontal: 14, marginTop: 6, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.15)', backgroundColor: 'rgba(10, 25, 52, 0.8)' },
  headerContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  title: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  subtextHeader: { color: '#88A2C7', fontSize: 11, fontWeight: '500' },
  logoutBtn: { backgroundColor: 'rgba(255, 75, 75, 0.15)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  logoutText: { color: '#FF7B7B', fontSize: 12, fontWeight: '600' },

  wrapper: { flex: 1, paddingHorizontal: 14, paddingTop: 14 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  addBtn: { backgroundColor: '#1E78FF', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  addBtnText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },

  tabContainer: { flexDirection: 'row', backgroundColor: 'rgba(15, 30, 60, 0.6)', borderRadius: 12, padding: 3, marginBottom: 12 },
  tabButton: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 9 },
  tabButtonActive: { backgroundColor: '#1E78FF' },
  tabText: { color: '#88A2C7', fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#FFFFFF', fontWeight: 'bold' },

  glassRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(13, 27, 56, 0.75)', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  glassRowSelected: { borderColor: '#00E676', backgroundColor: 'rgba(0, 230, 118, 0.12)' },
  iconContainer: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: 12 },

  rowText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  songHint: { color: '#88A2C7', fontSize: 11, marginTop: 2 },
  chevron: { color: '#5A7398', fontSize: 18 },
  checkbox: { color: '#6882A6', fontSize: 18, fontWeight: 'bold', marginLeft: 8 },
  checkboxActive: { color: '#00E676' },

  bottomActions: { flexDirection: 'row', gap: 10, paddingVertical: 10 },
  actionBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  btnText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 14 },

  navBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(15, 30, 60, 0.75)', padding: 10, borderRadius: 12, marginBottom: 10, gap: 8 },
  backBtn: { backgroundColor: 'rgba(30, 120, 255, 0.3)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  backBtnText: { color: '#68B0FF', fontSize: 13, fontWeight: 'bold' },
  navTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: 'bold', flex: 1 },
  sortButton: { backgroundColor: 'rgba(0, 230, 118, 0.15)', borderWidth: 1, borderColor: '#00E676', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  sortButtonText: { color: '#00E676', fontSize: 12, fontWeight: 'bold' },

  emptyCard: { alignItems: 'center', marginTop: 40, paddingHorizontal: 20 },
  emptyTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  emptySub: { color: '#88A2C7', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  emptyText: { color: '#88A2C7', textAlign: 'center', marginTop: 30 },

  // Mini reproductor
  miniPlayer: { backgroundColor: 'rgba(10, 24, 52, 0.98)', borderTopWidth: 1, borderTopColor: 'rgba(30, 120, 255, 0.4)', paddingHorizontal: 14, paddingTop: 2, paddingBottom: 8 },
  playerControlsRow: { flexDirection: 'row', alignItems: 'center' },
  playerSongTitle: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 13 },
  playerFolderHint: { color: '#88A2C7', fontSize: 11, marginTop: 2 },
  playerIconBtn: { padding: 8 },
  playPauseBtn: { backgroundColor: '#1E78FF', width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center', marginHorizontal: 6 },

  // Barra de navegación inferior
  tabBarContainer: { flexDirection: 'row', backgroundColor: 'rgba(6, 16, 36, 0.98)', borderTopWidth: 1, borderTopColor: 'rgba(255, 255, 255, 0.1)', paddingVertical: 8 },
  tabBarItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabBarItemActive: {},
  tabBarLabel: { color: '#6882A6', fontSize: 11, fontWeight: '600', marginTop: 3 },
  tabBarLabelActive: { color: '#1E78FF', fontWeight: 'bold' },

  fullPlayerContainer: { flex: 1, backgroundColor: '#050D1E' },
  fullPlayerSafe: { flex: 1, paddingHorizontal: 24, justifyContent: 'space-between', paddingBottom: 30 },
  fullPlayerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10 },
  fullPlayerCloseBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  fullPlayerCloseText: { color: '#fff', fontSize: 32, fontWeight: '300' },
  fullPlayerHeaderSub: { color: '#88A2C7', fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  fullPlayerHeaderTitle: { color: '#fff', fontSize: 14, fontWeight: 'bold', marginTop: 2 },

  fullArtContainer: { alignItems: 'center', justifyContent: 'center', marginVertical: 20 },
  vinylFull: { width: 260, height: 260, borderRadius: 130, backgroundColor: '#0b0f19', borderWidth: 8, borderColor: '#111827', alignItems: 'center', justifyContent: 'center', shadowColor: '#1E78FF', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.4, shadowRadius: 20, elevation: 10 },
  vinylGroove1: { width: 220, height: 220, borderRadius: 110, borderWidth: 1, borderColor: 'rgba(30, 120, 255, 0.2)', alignItems: 'center', justifyContent: 'center' },
  vinylGroove2: { width: 180, height: 180, borderRadius: 90, borderWidth: 1, borderColor: 'rgba(30, 120, 255, 0.15)', alignItems: 'center', justifyContent: 'center' },
  vinylCenterFull: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#1E78FF', alignItems: 'center', justifyContent: 'center' },

  fullSongInfo: { paddingHorizontal: 10, marginBottom: 15 },
  fullSongTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: 'bold', marginBottom: 4 },
  fullFolderSub: { color: '#88A2C7', fontSize: 14 },

  fullProgressContainer: { marginBottom: 10 },
  fullTimeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  fullTimeText: { color: '#88A2C7', fontSize: 12 },

  fullControlsRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingHorizontal: 10, marginBottom: 10 },
  fullSideControlBtn: { padding: 12 },
  fullPlayBtn: { backgroundColor: '#1E78FF', width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center', shadowColor: '#1E78FF', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 10 },

  // Estilos del Modal de Playlist
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { backgroundColor: '#0A1934', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 20, padding: 20, width: '100%', maxWidth: 340 },
  modalTitle: { color: '#FFF', fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  modalSub: { color: '#88A2C7', fontSize: 12, textAlign: 'center', marginBottom: 15 },
  modalRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(13, 27, 56, 0.9)', padding: 10, borderRadius: 10, marginBottom: 6 },
  modalRowText: { color: '#FFF', fontSize: 14, flex: 1, fontWeight: '600' },
  newPlaylistContainer: { flexDirection: 'row', marginTop: 10, gap: 8 },
  inputNewPlaylist: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 10, paddingHorizontal: 12, color: '#FFF', height: 40, fontSize: 13 },
  createPlBtn: { backgroundColor: '#1E78FF', justifyContent: 'center', paddingHorizontal: 16, borderRadius: 10 },
  createPlText: { color: '#FFF', fontWeight: 'bold', fontSize: 13 },
  closeModalBtn: { marginTop: 15, backgroundColor: '#222', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  closeModalText: { color: '#FFF', fontWeight: 'bold', fontSize: 13 },

  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  glassCardWelcome: { backgroundColor: 'rgba(10, 25, 52, 0.85)', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.15)', borderRadius: 24, padding: 24, alignItems: 'center', width: '100%', maxWidth: 360 },
  welcomeTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: 'bold', marginBottom: 8 },
  welcomeSubtitle: { color: '#88A2C7', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  solidButton: { backgroundColor: '#1E78FF', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 14, width: '100%', alignItems: 'center' },
});