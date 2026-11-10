using Surround.Engine.Audio;

namespace Surround.Engine.Tests;

public class DeviceClassifierTests
{
    [Theory]
    [InlineData("BTHENUM", "Hoparlör (Pill)", true, false)]
    [InlineData("BTHLEDevice", "Speaker", true, false)]
    [InlineData("bthenum", "Pill Stereo", true, false)]
    [InlineData("BTHENUM", "Pill Hands-Free AG Audio", true, true)]
    [InlineData(null, "Headset (Foo Bluetooth)", true, false)]
    [InlineData(null, "Foo Hands-Free", true, true)]
    [InlineData(null, "Foo AG Audio", true, true)]
    [InlineData("USB", "Hoparlör (Realtek)", false, false)]
    [InlineData("MMDEVAPI", "CABLE Input (VB-Audio Virtual Cable)", false, false)]
    [InlineData(null, null, false, false)]
    public void Classify(string? en, string? name, bool bt, bool hf)
    {
        var r = DeviceClassifier.Classify(en, name);
        Assert.Equal(bt, r.Bluetooth);
        Assert.Equal(hf, r.HandsFree);
    }
}
