import React from 'react';
import { BluetoothTiltClient, type TiltPacket } from '../lib/BluetoothTiltClient';

type TiltReading = {
  pitch: number | null;
  roll: number | null;
  magnitude: number | null;
};

function parseTiltPacket(packet: TiltPacket): TiltReading {
  if (packet === null) {
    return { pitch: null, roll: null, magnitude: null };
  }

  return {
    pitch: packet.pitch,
    roll: packet.roll,
    magnitude: packet.magnitude,
  };
}

function formatValue(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return '--';
  }

  return value.toFixed(2);
}

export default function TiltTelemetry() {
  const [isConnecting, setIsConnecting] = React.useState(false);
  const [isConnected, setIsConnected] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reading, setReading] = React.useState<TiltReading>({ pitch: null, roll: null, magnitude: null });
  const clientRef = React.useRef<BluetoothTiltClient | null>(null);

  const connectToDevice = async () => {
    setError(null);
    setIsConnecting(true);

    try {
      if (!clientRef.current) {
        clientRef.current = new BluetoothTiltClient(
            { namePrefix: "ESP32" }
        );
      }

      const client = clientRef.current;
      client.onTilt = (packet: TiltPacket) => {
        setReading(parseTiltPacket(packet));
      };
      client.onDisconnect = () => {
        setIsConnected(false);
      };

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
      if (clientRef.current) {
        clientRef.current.disconnect();
      }
    };
  }, []);

  return (
    <div className="absolute top-6 left-1/2 -translate-x-1/2 z-30 w-[min(92vw,34rem)]">
      <div
        className="backdrop-blur-md border border-white/25 rounded-xl px-4 py-3"
        style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.75), rgba(51, 65, 85, 0.45))',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.25)',
          fontFamily: 'Rubik, sans-serif',
        }}
      >
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-sm text-white/90 tracking-wide">Tilt Telemetry</h2>
          {isConnected ? (
            <button
              type="button"
              onClick={disconnectFromDevice}
              className="text-xs px-3 py-1.5 rounded-md border border-white/25 text-white/90 hover:bg-white/10 transition-colors"
            >
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              onClick={connectToDevice}
              disabled={isConnecting}
              className="text-xs px-3 py-1.5 rounded-md border border-white/25 text-white/90 hover:bg-white/10 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isConnecting ? 'Connecting...' : 'Connect Bluetooth'}
            </button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md bg-white/5 border border-white/10 px-2 py-2">
            <p className="text-[11px] uppercase tracking-wider text-white/60">Pitch</p>
            <p className="text-base text-white font-medium">{formatValue(reading.pitch)}</p>
          </div>
          <div className="rounded-md bg-white/5 border border-white/10 px-2 py-2">
            <p className="text-[11px] uppercase tracking-wider text-white/60">Roll</p>
            <p className="text-base text-white font-medium">{formatValue(reading.roll)}</p>
          </div>
          <div className="rounded-md bg-white/5 border border-white/10 px-2 py-2">
            <p className="text-[11px] uppercase tracking-wider text-white/60">Magnitude</p>
            <p className="text-base text-white font-medium">{formatValue(reading.magnitude)}</p>
          </div>
        </div>

        {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
      </div>
    </div>
  );
}
