import React, { useState, useRef, useEffect } from 'react';
import { Volume2, VolumeX, Power } from 'lucide-react';

export default function App() {
  const [isActive, setIsActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [selectedAmp, setSelectedAmp] = useState('clean');
  const [gain, setGain] = useState(30);
  const [tone, setTone] = useState(50);
  const [volume, setVolume] = useState(50);
  const [reverbAmount, setReverbAmount] = useState(20);
  const [delayAmount, setDelayAmount] = useState(0);
  const [inputLevel, setInputLevel] = useState(0);
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  
  const audioContextRef = useRef(null);
  const sourceRef = useRef(null);
  const analyserRef = useRef(null);
  const gainNodeRef = useRef(null);
  const distortionRef = useRef(null);
  const filterRef = useRef(null);
  const volumeNodeRef = useRef(null);
  const convolverRef = useRef(null);
  const delayNodeRef = useRef(null);
  const delayGainRef = useRef(null);
  const reverbGainRef = useRef(null);
  const dryGainRef = useRef(null);
  const streamRef = useRef(null);

  const amps = {
    clean: { name: 'Clean', color: 'bg-blue-500' },
    crunch: { name: 'Crunch', color: 'bg-orange-500' },
    overdrive: { name: 'Overdrive', color: 'bg-red-500' },
    distortion: { name: 'Distortion', color: 'bg-purple-500' },
    fuzz: { name: 'Fuzz', color: 'bg-pink-500' },
    metal: { name: 'Metal', color: 'bg-gray-800' }
  };

  const makeDistortionCurve = (amount) => {
    const samples = 44100;
    const curve = new Float32Array(samples);
    const deg = Math.PI / 180;
    
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      if (amount === 0) {
        curve[i] = x;
      } else {
        curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
      }
    }
    return curve;
  };

  const createImpulseResponse = (context, duration, decay) => {
    const length = context.sampleRate * duration;
    const impulse = context.createBuffer(2, length, context.sampleRate);
    
    for (let channel = 0; channel < 2; channel++) {
      const channelData = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  };

  const getDevices = async () => {
    try {
      const deviceList = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = deviceList.filter(device => device.kind === 'audioinput');
      setDevices(audioInputs);
      if (!selectedDeviceId && audioInputs.length > 0) {
        setSelectedDeviceId(audioInputs[0].deviceId);
      }
    } catch (err) {
      console.error('Erro ao listar dispositivos:', err);
    }
  };

  const startAudio = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Seu navegador não suporta acesso ao microfone. Use Chrome, Firefox ou Edge.');
        return;
      }

      const constraints = {
        audio: {
          deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          latency: 0
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      streamRef.current = stream;
      const context = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = context;

      if (context.state === 'suspended') {
        await context.resume();
      }

      const source = context.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Analyser for input level
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      source.connect(analyser);

      // Gain node (pré-distorção)
      const preGain = context.createGain();
      gainNodeRef.current = preGain;

      // Distortion
      const distortion = context.createWaveShaper();
      distortionRef.current = distortion;

      // Filter (tone control)
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filterRef.current = filter;

      // Delay
      const delay = context.createDelay(2.0);
      delay.delayTime.value = 0.3;
      delayNodeRef.current = delay;

      const delayFeedback = context.createGain();
      delayFeedback.gain.value = 0.4;

      const delayGain = context.createGain();
      delayGain.gain.value = 0;
      delayGainRef.current = delayGain;

      // Reverb
      const convolver = context.createConvolver();
      convolver.buffer = createImpulseResponse(context, 2, 2);
      convolverRef.current = convolver;

      const reverbGain = context.createGain();
      reverbGain.gain.value = 0.2;
      reverbGainRef.current = reverbGain;

      // Dry signal
      const dryGain = context.createGain();
      dryGain.gain.value = 0.8;
      dryGainRef.current = dryGain;

      // Volume final
      const outputVolume = context.createGain();
      volumeNodeRef.current = outputVolume;

      // Routing
      source.connect(preGain);
      preGain.connect(distortion);
      distortion.connect(filter);
      
      // Dry path
      filter.connect(dryGain);
      dryGain.connect(outputVolume);
      
      // Delay path
      filter.connect(delayGain);
      delayGain.connect(delay);
      delay.connect(delayFeedback);
      delayFeedback.connect(delay);
      delay.connect(outputVolume);
      
      // Reverb path
      filter.connect(reverbGain);
      reverbGain.connect(convolver);
      convolver.connect(outputVolume);
      
      outputVolume.connect(context.destination);

      updateAmpSettings();
      setIsActive(true);
    } catch (err) {
      console.error('Erro detalhado:', err);
      
      let errorMessage = 'Erro ao acessar o áudio. ';
      
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMessage += 'Você negou a permissão. Clique no ícone de cadeado na barra de endereço e permita o acesso ao microfone.';
      } else if (err.name === 'NotFoundError') {
        errorMessage += 'Nenhum dispositivo de áudio encontrado. Conecte sua guitarra/microfone e recarregue a página.';
      } else if (err.name === 'NotReadableError') {
        errorMessage += 'O dispositivo de áudio está sendo usado por outro aplicativo. Feche outros programas que usam o microfone.';
      } else {
        errorMessage += err.message || 'Verifique se o microfone está conectado e as permissões do navegador.';
      }
      
      alert(errorMessage);
    }
  };

  const stopAudio = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    setIsActive(false);
  };

  const updateAmpSettings = () => {
    if (!audioContextRef.current) return;

    const ampSettings = {
      clean: { gain: 0.5, distortion: 0, cutoff: 8000 },
      crunch: { gain: 2, distortion: 20, cutoff: 5000 },
      overdrive: { gain: 4, distortion: 40, cutoff: 4000 },
      distortion: { gain: 8, distortion: 80, cutoff: 3500 },
      fuzz: { gain: 12, distortion: 120, cutoff: 3000 },
      metal: { gain: 15, distortion: 150, cutoff: 4500 }
    };

    const settings = ampSettings[selectedAmp];
    const gainMultiplier = gain / 30;

    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = settings.gain * gainMultiplier;
    }

    if (distortionRef.current) {
      distortionRef.current.curve = makeDistortionCurve(settings.distortion * gainMultiplier);
    }

    if (filterRef.current) {
      const toneMultiplier = tone / 50;
      filterRef.current.frequency.value = settings.cutoff * toneMultiplier;
      filterRef.current.Q.value = 1;
    }

    if (volumeNodeRef.current) {
      volumeNodeRef.current.gain.value = isMuted ? 0 : (volume / 100);
    }

    if (reverbGainRef.current && dryGainRef.current) {
      const reverbLevel = reverbAmount / 100;
      reverbGainRef.current.gain.value = reverbLevel * 0.4;
      dryGainRef.current.gain.value = 1 - (reverbLevel * 0.3);
    }

    if (delayGainRef.current) {
      delayGainRef.current.gain.value = delayAmount / 100;
    }
  };

  useEffect(() => {
    updateAmpSettings();
  }, [selectedAmp, gain, tone, volume, reverbAmount, delayAmount, isMuted]);

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, []);

  useEffect(() => {
    getDevices();
  }, []);

  useEffect(() => {
    if (!isActive || !analyserRef.current) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);

    const updateLevel = () => {
      if (!analyser) return;
      analyser.getByteTimeDomainData(dataArray);
      const rms = Math.sqrt(dataArray.reduce((sum, val) => sum + (val - 128) * (val - 128), 0) / bufferLength);
      setInputLevel(Math.round(rms * 100));
      console.log('RMS:', rms, 'Level:', Math.round(rms * 100));
      requestAnimationFrame(updateLevel);
    };

    updateLevel();
  }, [isActive]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black p-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-gradient-to-b from-amber-900 to-amber-950 rounded-3xl shadow-2xl p-8 border-4 border-amber-700">
          
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-amber-200 mb-2" style={{ fontFamily: 'Impact, sans-serif' }}>
              GUITAR AMP
            </h1>
            <p className="text-amber-400 text-sm">Simulador de Amplificador Virtual</p>
          </div>

          {/* Power Button */}
          <div className="flex justify-center mb-8">
            <button
              onClick={isActive ? stopAudio : startAudio}
              className={`relative group ${isActive ? 'bg-green-500' : 'bg-red-600'} rounded-full p-6 shadow-lg transition-all duration-300 hover:scale-110`}
            >
              <Power className="w-8 h-8 text-white" />
              {isActive && (
                <div className="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-75"></div>
              )}
            </button>
            <span className="ml-4 self-center text-amber-200 font-semibold">
              {isActive ? 'LIGADO' : 'DESLIGADO'}
            </span>
            {isActive && (
              <div className="ml-4 self-center">
                <div className="text-amber-200 text-sm">NÍVEL DE ENTRADA</div>
                <div className="w-32 bg-gray-700 rounded-full h-2 mt-1">
                  <div 
                    className="bg-green-500 h-2 rounded-full transition-all duration-100"
                    style={{ width: `${Math.min(inputLevel * 2, 100)}%` }}
                  ></div>
                </div>
                <div className="text-amber-300 text-xs mt-1 font-mono">{inputLevel}</div>
              </div>
            )}
            <div className="ml-4 self-center">
              <label className="block text-amber-200 text-sm mb-1">ENTRADA DE ÁUDIO</label>
              <select
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                disabled={isActive}
                className="bg-gray-700 text-amber-200 rounded px-2 py-1 text-sm disabled:opacity-50"
              >
                {devices.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Microfone ${device.deviceId.slice(0, 8)}`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Amp Selection */}
          <div className="mb-8">
            <label className="block text-amber-200 font-bold mb-3 text-center text-lg">
              CANAL
            </label>
            <div className="grid grid-cols-3 gap-3">
              {Object.entries(amps).map(([key, amp]) => (
                <button
                  key={key}
                  onClick={() => setSelectedAmp(key)}
                  disabled={!isActive}
                  className={`py-3 px-4 rounded-lg font-bold transition-all ${
                    selectedAmp === key
                      ? `${amp.color} text-white shadow-lg scale-105`
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {amp.name}
                </button>
              ))}
            </div>
          </div>

          {/* Controls */}
          <div className="grid grid-cols-2 gap-6 mb-6">
            {/* Gain */}
            <div className="bg-black bg-opacity-30 p-4 rounded-lg">
              <label className="block text-amber-200 font-bold mb-2">
                GAIN
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={gain}
                onChange={(e) => setGain(Number(e.target.value))}
                disabled={!isActive}
                className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-orange-500"
              />
              <div className="text-amber-300 text-center mt-1 font-mono">
                {gain}
              </div>
            </div>

            {/* Tone */}
            <div className="bg-black bg-opacity-30 p-4 rounded-lg">
              <label className="block text-amber-200 font-bold mb-2">
                TONE
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={tone}
                onChange={(e) => setTone(Number(e.target.value))}
                disabled={!isActive}
                className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-yellow-500"
              />
              <div className="text-amber-300 text-center mt-1 font-mono">
                {tone}
              </div>
            </div>

            {/* Volume */}
            <div className="bg-black bg-opacity-30 p-4 rounded-lg">
              <label className="block text-amber-200 font-bold mb-2 flex items-center justify-between">
                <span>VOLUME</span>
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  disabled={!isActive}
                  className="text-amber-400 hover:text-amber-200 disabled:opacity-50"
                >
                  {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </button>
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                disabled={!isActive}
                className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
              <div className="text-amber-300 text-center mt-1 font-mono">
                {volume}
              </div>
            </div>

            {/* Reverb */}
            <div className="bg-black bg-opacity-30 p-4 rounded-lg">
              <label className="block text-amber-200 font-bold mb-2">
                REVERB
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={reverbAmount}
                onChange={(e) => setReverbAmount(Number(e.target.value))}
                disabled={!isActive}
                className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-purple-500"
              />
              <div className="text-amber-300 text-center mt-1 font-mono">
                {reverbAmount}
              </div>
            </div>
          </div>

          {/* Delay */}
          <div className="bg-black bg-opacity-30 p-4 rounded-lg">
            <label className="block text-amber-200 font-bold mb-2">
              DELAY
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={delayAmount}
              onChange={(e) => setDelayAmount(Number(e.target.value))}
              disabled={!isActive}
              className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-green-500"
            />
            <div className="text-amber-300 text-center mt-1 font-mono">
              {delayAmount}
            </div>
          </div>

          {/* Instructions */}
          {!isActive && (
            <div className="mt-6 p-4 bg-yellow-900 bg-opacity-30 rounded-lg border border-yellow-700">
              <p className="text-amber-200 text-sm text-center font-bold mb-2">
                📋 INSTRUÇÕES:
              </p>
              <ol className="text-amber-200 text-sm space-y-1 text-left list-decimal list-inside">
                <li>Conecte sua guitarra/interface de áudio ao computador</li>
                <li>Clique no botão POWER vermelho acima</li>
                <li>IMPORTANTE: O navegador vai pedir permissão - clique em "Permitir"</li>
                <li>Use fones de ouvido para evitar feedback</li>
              </ol>
              <p className="text-amber-300 text-xs mt-3 text-center">
                💡 Se o pop-up não aparecer, clique no ícone de cadeado 🔒 na barra de endereço
                e verifique as permissões de microfone
              </p>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="mt-6 text-center text-gray-400 text-sm">
          <p>🎸 Conecte sua guitarra via interface de áudio ou cabo adaptador</p>
          <p className="mt-2">Use fones de ouvido para evitar feedback</p>
        </div>
      </div>
    </div>
  );
}