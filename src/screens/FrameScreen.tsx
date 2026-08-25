import React from 'react';
import { Pressable, SafeAreaView, Text, TextInput, View } from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { styles } from '../components/Styles';

export function FrameScreen({ baseUrl, draftUrl, onChangeUrl, onSubmit, onNavigationChange }: {
  baseUrl: string;
  draftUrl: string;
  onChangeUrl: (value: string) => void;
  onSubmit: () => void;
  onNavigationChange: (state: WebViewNavigation) => void;
}) {
  if (baseUrl) return <WebView source={{ uri: `${baseUrl}/frame?closeAction=urlParam` }} style={styles.webview} onNavigationStateChange={onNavigationChange} />;
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
