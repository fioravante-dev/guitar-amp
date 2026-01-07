import { useState, useRef, useEffect } from 'react';
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
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const distortionRef = useRef<WaveShaperNode | null>(null);
  const filterRef = useRef<BiquadFilterNode | null>(null);
  const volumeNodeRef = useRef<GainNode | null>(null);
  const convolverRef = useRef<ConvolverNode | null>(null);
  const delayNodeRef = useRef<DelayNode | null>(null);
  const delayGainRef = useRef<GainNode | null>(null);
  const reverbGainRef = useRef<GainNode | null>(null);
  const dryGainRef = useRef<GainNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const amps = {
    clean: { name: 'Clean', color: 'bg-blue-500' },
    acoustic: { name: 'Acoustic', color: 'bg-green-500' },
    crunch: { name: 'Crunch', color: 'bg-orange-500' },
    overdrive: { name: 'Overdrive', color: 'bg-red-500' },
    distortion: { name: 'Distortion', color: 'bg-purple-500' },
    fuzz: { name: 'Fuzz', color: 'bg-pink-500' },
    metal: { name: 'Metal', color: 'bg-gray-800' }
  };

  const makeDistortionCurve = (amount: number) => {
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

  const createImpulseResponse = (context: AudioContext, duration: number, decay: number) => {
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
          latency: 0,
          channelCount: 1
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      streamRef.current = stream;
      const context = new (window.AudioContext || (window as any).webkitAudioContext)({ 
        latencyHint: 'interactive',
        sampleRate: 44100 
      });
      audioContextRef.current = context;

      if (context.state === 'suspended') {
        await context.resume();
      }

      const source = context.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Analyser for input level
      const analyser = context.createAnalyser();
      analyser.fftSize = 128;
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
    } catch (error) {
      const err = error as any;
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
      streamRef.current.getTracks().forEach((track: MediaStreamTrack) => track.stop());
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
      acoustic: { gain: 0.3, distortion: 0, cutoff: 12000 },
      crunch: { gain: 2, distortion: 20, cutoff: 5000 },
      overdrive: { gain: 4, distortion: 40, cutoff: 4000 },
      distortion: { gain: 8, distortion: 80, cutoff: 3500 },
      fuzz: { gain: 12, distortion: 120, cutoff: 3000 },
      metal: { gain: 15, distortion: 150, cutoff: 4500 }
    };

    const settings = ampSettings[selectedAmp as keyof typeof ampSettings];
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
    let intervalId: number | null = null;

    const updateInputLevel = () => {
      if (analyserRef.current) {
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteTimeDomainData(dataArray);
        
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const sample = (dataArray[i] - 128) / 128;
          sum += sample * sample;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        setInputLevel(rms * 100);
      }
    };
    
    if (isActive) {
      updateInputLevel();
      intervalId = window.setInterval(updateInputLevel, 8); // ~120fps
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isActive]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black text-white p-4">
      <div className="max-w-4xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            Guitar Amp Simulator
          </h1>
          <p className="text-gray-400">Simulador de amplificador de guitarra virtual</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Controles principais */}
          <div className="lg:col-span-2 space-y-6">
            {/* Power e dispositivos */}
            <div className="bg-gray-800 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={isActive ? stopAudio : startAudio}
                  className={`flex items-center gap-2 px-6 py-3 rounded-lg font-semibold transition-all ${
                    isActive
                      ? 'bg-red-600 hover:bg-red-700 text-white'
                      : 'bg-green-600 hover:bg-green-700 text-white'
                  }`}
                >
                  <Power size={20} />
                  {isActive ? 'DESLIGAR' : 'LIGAR'}
                </button>
                
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className={`p-3 rounded-lg transition-all ${
                    isMuted ? 'bg-red-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                  }`}
                >
                  {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                </button>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">Dispositivo de Áudio</label>
                <select
                  value={selectedDeviceId}
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white"
                  disabled={isActive}
                >
                  {devices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Microfone ${device.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Seletor de amplificador */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-4">Tipo de Amplificador</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {Object.entries(amps).map(([key, amp]) => (
                  <button
                    key={key}
                    onClick={() => setSelectedAmp(key)}
                    className={`p-3 rounded-lg font-medium transition-all ${
                      selectedAmp === key
                        ? `${amp.color} text-white shadow-lg`
                        : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                    }`}
                  >
                    {amp.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Controles de som */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-4">Controles</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium mb-2">Gain: {gain}</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={gain}
                    onChange={(e) => setGain(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">Tone: {tone}</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={tone}
                    onChange={(e) => setTone(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">Volume: {volume}</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={volume}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">Reverb: {reverbAmount}</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={reverbAmount}
                    onChange={(e) => setReverbAmount(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
                
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium mb-2">Delay: {delayAmount}</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={delayAmount}
                    onChange={(e) => setDelayAmount(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Medidor de nível */}
          <div className="space-y-6">
            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-4">Nível de Entrada</h3>
              <div className="relative h-64 bg-gray-700 rounded-lg overflow-hidden">
                <div
                  className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-green-500 via-yellow-500 to-red-500 transition-all duration-100"
                  style={{ height: `${Math.min(inputLevel * 2, 100)}%` }}
                />
                <div className="absolute inset-0 flex items-end justify-center pb-2">
                  <span className="text-xs font-mono text-white bg-black bg-opacity-50 px-2 py-1 rounded">
                    {Math.round(inputLevel)}%
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-4">Status</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span>Amplificador:</span>
                  <span className={`font-medium ${isActive ? 'text-green-400' : 'text-red-400'}`}>
                    {isActive ? 'LIGADO' : 'DESLIGADO'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Tipo:</span>
                  <span className="font-medium text-blue-400">
                    {amps[selectedAmp as keyof typeof amps].name}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Áudio:</span>
                  <span className={`font-medium ${isMuted ? 'text-red-400' : 'text-green-400'}`}>
                    {isMuted ? 'MUDO' : 'ATIVO'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <footer className="text-center mt-8 text-gray-500 text-sm">
          <p>Conecte sua guitarra ao microfone do computador e ajuste os controles para obter o som desejado.</p>
        </footer>
      </div>
    </div>
  );
}