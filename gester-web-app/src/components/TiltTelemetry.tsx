import React from 'react';
import { BluetoothTiltClient, type TiltPacket } from '../lib/BluetoothTiltClient';
import { tiltStore } from '../lib/tiltStore';

export default function TiltTelemetry() {
  const [isConnecting, setIsConnecting] = React.useState(false);
  const [isConnected, setIsConnected] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const clientRef = React.useRef<BluetoothTiltClient | null>(null);

  const connectToDevice = async () => {
    setError(null);
    setIsConnecting(true);
    try {
      if (!clientRef.current) {
        clientRef.current = new BluetoothTiltClient({ namePrefix: 'ESP32' });
      }
      const client = clientRef.current;
      client.onTilt = (packet: TiltPacket) => {
        if (packet) {
          tiltStore.publish({
            pitch: packet.pitch,
            roll: packet.roll,
            magnitude: packet.magnitude,
          });
        }
      };
      client.onDisconnect = () => setIsConnected(false);
      await client.connect();
      setIsConnected(true);
    } catch (connectError) {
      const message = connectError instanceof Error ? connectError.message : 'Failed to connect to Bluetooth device.';
      setError(message);
      setIsConnected(false);
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectFromDevice = async () => {
    setError(null);
    try {
      await clientRef.current?.disconnect();
    } catch (disconnectError) {
      const message = disconnectError instanceof Error ? disconnectError.message : 'Failed to disconnect device.';
      setError(message);
    } finally {
      setIsConnected(false);
    }
  };

  React.useEffect(() => {
    return () => {
      clientRef.current?.disconnect();
    };
  }, []);

  return (
    <div
      className="absolute top-4 left-4 z-30 flex flex-col items-start gap-1"
      style={{ fontFamily: 'Atkinson Hyperlegible, sans-serif' }}
    >
      <button
        type="button"
        onClick={isConnected ? disconnectFromDevice : connectToDevice}
        disabled={isConnecting}
        className="text-xs px-3 py-1.5 rounded-md backdrop-blur-md border transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
        style={{
          background: isConnected
            ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.25), rgba(20, 83, 45, 0.45))'
            : 'linear-gradient(135deg, rgba(30, 41, 59, 0.75), rgba(51, 65, 85, 0.45))',
          borderColor: isConnected ? 'rgba(74, 222, 128, 0.5)' : 'rgba(255,255,255,0.25)',
          color: 'rgba(255,255,255,0.9)',
          boxShadow: isConnected ? '0 0 12px rgba(34, 197, 94, 0.35)' : '0 4px 12px rgba(0,0,0,0.25)',
        }}
      >
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{
            background: isConnected ? '#4ade80' : isConnecting ? '#facc15' : '#94a3b8',
            boxShadow: isConnected ? '0 0 6px #4ade80' : 'none',
          }}
        />
        {isConnected ? 'Disconnect' : isConnecting ? 'Connecting…' : 'Connect Bluetooth'}
      </button>
      {error && <p className="text-[11px] text-rose-300 max-w-[16rem]">{error}</p>}
    </div>
  );
}
