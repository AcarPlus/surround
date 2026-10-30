using NAudio.CoreAudioApi;

namespace Surround.Engine.Audio;

/// <summary>
/// WasapiLoopbackCapture only exposes the default 100 ms buffer (large bursts); this variant has the same
/// loopback behaviour but a configurable buffer so packets arrive in small chunks.
/// </summary>
internal sealed class LoopbackCapture : WasapiCapture
{
    public LoopbackCapture(MMDevice renderDevice, int bufferMs) : base(renderDevice, false, bufferMs) { }

    protected override AudioClientStreamFlags GetAudioClientStreamFlags() =>
        AudioClientStreamFlags.Loopback | base.GetAudioClientStreamFlags();
}
