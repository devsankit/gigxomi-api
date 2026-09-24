declare module "lamejs/lame.all.js" {
  export type Mp3EncoderInstance = {
    encodeBuffer: (left: Int16Array, right?: Int16Array) => Int8Array;
    flush: () => Int8Array;
  };

  export type Mp3EncoderConstructor = new (channels: number, samplerate: number, kbps: number) => Mp3EncoderInstance;

  const lame: {
    Mp3Encoder: Mp3EncoderConstructor;
    WavHeader: unknown;
  };

  export default lame;
}

