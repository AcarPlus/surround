using NAudio.CoreAudioApi;
using Surround.Engine.Audio;

namespace Surround.Engine.Tests;

/// <summary>
/// The direct property reads give what NAudio's (much slower) lookups give, on whatever endpoints this machine has
/// (none on a build server: nothing to compare then).
/// </summary>
public class EndpointPropertiesTests
{
    [Fact]
    public void ReadsTheSameNameAndEnumeratorAsNAudio()
    {
        using var en = new MMDeviceEnumerator();
        var key = new PropertyKey(new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), 24);
        foreach (var flow in new[] { DataFlow.Render, DataFlow.Capture })
            foreach (var dev in en.EnumerateAudioEndPoints(flow, DeviceState.Active))
                using (dev)
                {
                    var (name, enumerator) = EndpointProperties.Read(dev.ID);
                    Assert.Equal(dev.FriendlyName, name);
                    string? expected = dev.Properties.Contains(key) ? dev.Properties[key].Value as string : null;
                    Assert.Equal(expected, enumerator);
                }
    }

    [Fact]
    public void UnknownIdReadsNothing()
    {
        Assert.Equal((null, null), EndpointProperties.Read("{0.0.0.00000000}.{00000000-0000-0000-0000-000000000000}"));
        Assert.Equal((null, null), EndpointProperties.Read(""));
    }
}
