import { useState } from 'react';
import { Pressable, View } from 'react-native';

type Props = {
  /** Progreso entre 0 y 1 */
  progress: number;
  /** Se llama con la posición tocada, entre 0 y 1 */
  onSeek: (fraction: number) => void;
  height?: number;
  /** Espacio extra arriba y abajo para que sea fácil de tocar */
  touchPad?: number;
};

export function SeekBar({ progress, onSeek, height = 6, touchPad = 10 }: Props) {
  const [width, setWidth] = useState(1);
  const safe = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));

  return (
    <Pressable
      onLayout={e => setWidth(e.nativeEvent.layout.width || 1)}
      onPress={e => {
        const fraction = e.nativeEvent.locationX / width;
        onSeek(Math.max(0, Math.min(1, fraction)));
      }}
      style={{ paddingVertical: touchPad }}>
      <View
        pointerEvents="none"
        style={{
          height,
          borderRadius: height / 2,
          overflow: 'hidden',
          backgroundColor: 'rgba(255, 255, 255, 0.15)',
        }}>
        <View style={{ height: '100%', width: `${safe * 100}%`, backgroundColor: '#00E676' }} />
      </View>
    </Pressable>
  );
}