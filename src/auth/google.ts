import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { WEB_CLIENT_ID } from "./config";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

export function configureGoogle() {
  GoogleSignin.configure({
    webClientId: WEB_CLIENT_ID,
    scopes: [DRIVE_SCOPE],
  });
}

export async function signInWithGoogle() {
  await GoogleSignin.hasPlayServices();
  const res: any = await GoogleSignin.signIn();
  if (res?.type === "cancelled") return null;
  return res?.data?.user ?? res?.user ?? null;
}

export async function getAccessToken(): Promise<string> {
  const { accessToken } = await GoogleSignin.getTokens();
  return accessToken;
}

export async function signOutGoogle() {
  await GoogleSignin.signOut();
}