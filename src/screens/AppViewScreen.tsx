import React from 'react';
import { Alert, FlatList, Image, Linking, Pressable, SafeAreaView, Text, View } from 'react-native';
import { styles } from '../components/Styles';

export type InstalledApp = { packageName: string; label: string; icon?: string };

export function AppViewScreen({ apps, pinnedPackages, releaseUrl, onBack, onSettings, onOpenApp, onOpenAppInfo, onTogglePinned }: {
  apps: InstalledApp[];
  pinnedPackages: string[];
  releaseUrl: string | null;
  onBack: () => void;
  onSettings: () => void;
  onOpenApp: (packageName: string) => void;
  onOpenAppInfo: (packageName: string) => void;
  onTogglePinned: (packageName: string) => void;
}) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Apps</Text>
        <View style={styles.buttonRow}>
          <Pressable onPress={onSettings} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Settings</Text></Pressable>
          <Pressable onPress={onBack} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Frame</Text></Pressable>
        </View>
      </View>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={apps}
        keyExtractor={(item) => item.packageName}
        ListHeaderComponent={releaseUrl ? <Pressable onPress={() => void Linking.openURL(releaseUrl)} style={styles.updateLink}><Text style={styles.updateLinkText}>Update available - GitHub Releases</Text></Pressable> : null}
        renderItem={({ item }) => (
          <Pressable onLongPress={() => Alert.alert(item.label, undefined, [{ text: pinnedPackages.includes(item.packageName) ? 'Unpin' : 'Pin', onPress: () => onTogglePinned(item.packageName) }, { text: 'App info', onPress: () => onOpenAppInfo(item.packageName) }, { text: 'Cancel', style: 'cancel' }])} onPress={() => onOpenApp(item.packageName)} style={styles.appRow}>
            {item.icon ? <Image source={{ uri: item.icon }} style={styles.appIcon} /> : <View style={styles.appIconFallback}><Text style={styles.appIconLetter}>{item.label.slice(0, 1)}</Text></View>}
            <View style={styles.appText}><Text style={styles.appTitle}>{item.label}</Text><Text style={styles.appPackage}>{item.packageName}</Text></View>
            {pinnedPackages.includes(item.packageName) ? <Text style={styles.pin}>Pinned</Text> : null}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
