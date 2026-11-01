using NAudio.CoreAudioApi;

namespace Surround.Engine.Audio;

/// <summary>
/// WasapiLoopbackCapture only exposes the default 100 ms buffer (large bursts); this variant has the same
/// loopback behaviour but a configurable buffer so packets arrive in small chunks. It is event driven: the polling
/// mode sleeps at the 15.6 ms timer resolution and overruns a 20 ms buffer, dropping ~5 % of the frames.
/// </summary>
internal sealed class LoopbackCapture : WasapiCapture
{
    public LoopbackCapture(MMDevice renderDevice, int bufferMs) : base(renderDevice, true, bufferMs) { }

    protected override AudioClientStreamFlags GetAudioClientStreamFlags() =>
        AudioClientStreamFlags.Loopback | base.GetAudioClientStreamFlags();
}
