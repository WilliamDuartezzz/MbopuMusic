import { router } from 'expo-router';
import { useEffect } from 'react';

export default function OAuthRedirect() {
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);
  return null;
}