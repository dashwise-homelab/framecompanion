import React from 'react';
import { Pressable, SafeAreaView, Text, TextInput, View } from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { styles } from '../components/Styles';

export function FrameScreen({ baseUrl, draftUrl, onChangeUrl, onSubmit, onNavigationChange, onWebViewError, onRetry, showWebViewError }: {
  baseUrl: string;
  draftUrl: string;
  onChangeUrl: (value: string) => void;
  onSubmit: () => void;
  onNavigationChange: (state: WebViewNavigation) => void;
  onWebViewError: () => void;
  onRetry: () => void;
  showWebViewError: boolean;
}) {
  if (baseUrl && showWebViewError) return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.onboardingCard}>
        <Text style={styles.eyebrow}>Frame unavailable</Text>
        <Text style={styles.title}>Could not load Dashwise</Text>
        <Text style={styles.body}>The frame could not be loaded. Draw the L-shaped gesture to open the apps view, or try again.</Text>
        <Pressable onPress={onRetry} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Try Again</Text></Pressable>
      </View>
    </SafeAreaView>
  );
  if (baseUrl) return <WebView source={{ uri: `${baseUrl}/frame?closeAction=urlParam` }} style={styles.webview} onError={onWebViewError} onNavigationStateChange={onNavigationChange} />;
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.onboardingCard}>
        <Text style={styles.eyebrow}>Smart Frame Setup</Text>
        <Text style={styles.title}>Connect Dashwise</Text>
        <Text style={styles.body}>Enter your Dashwise instance root URL. The frame view opens at /frame with closeAction=urlParam.</Text>
        <TextInput autoCapitalize="none" autoCorrect={false} keyboardType="url" onChangeText={onChangeUrl} onSubmitEditing={onSubmit} placeholder="https://dashwise.example.com" placeholderTextColor="#687080" returnKeyType="go" style={styles.input} value={draftUrl} />
        <Pressable onPress={onSubmit} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Open Frame</Text></Pressable>
      </View>
    </SafeAreaView>
  );
}
