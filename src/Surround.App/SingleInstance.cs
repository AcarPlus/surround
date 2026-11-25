namespace Surround.Desktop;

/// <summary>Per-user single instance: the first process owns a mutex and listens for an activation signal.</summary>
public sealed class SingleInstance : IDisposable
{
    // A run with its own data folder (Bridge.AppPaths.IsolatedDir) is its own instance.
    private static readonly string Suffix = Bridge.AppPaths.IsolatedDir is { } iso
        ? "." + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(iso.ToUpperInvariant())))[..12]
        : "";
    private static readonly string MutexName = @"Local\Surround.SingleInstance.5f0c8a1e" + Suffix;
    private static readonly string SignalName = @"Local\Surround.Activate.5f0c8a1e" + Suffix;

    private readonly Mutex _mutex;
    private readonly EventWaitHandle _signal;
    private readonly CancellationTokenSource _cts = new();

    /// <summary>Raised (on a worker thread) when a second launch asks the first instance to show itself.</summary>
    public event Action? Activated;

    private SingleInstance(Mutex mutex, EventWaitHandle signal)
    {
        _mutex = mutex;
        _signal = signal;
        new Thread(Listen) { IsBackground = true, Name = "Surround.SingleInstance" }.Start();
    }

    /// <summary>Returns the owner object for the first instance; for later ones signals the first and returns null.</summary>
    public static SingleInstance? TryAcquire()
    {
        var mutex = new Mutex(true, MutexName, out bool created);
        var signal = new EventWaitHandle(false, EventResetMode.AutoReset, SignalName);
        if (created) return new SingleInstance(mutex, signal);

        signal.Set();
        signal.Dispose();
        mutex.Dispose();
        return null;
    }

    private void Listen()
    {
        try
        {
            var handles = new[] { _signal, _cts.Token.WaitHandle };
            while (WaitHandle.WaitAny(handles) == 0) Activated?.Invoke();
        }
        catch (ObjectDisposedException) { /* shutting down */ }
    }

    public void Dispose()
    {
        _cts.Cancel();
        try { _mutex.ReleaseMutex(); } catch (ApplicationException) { }
        _mutex.Dispose();
        _signal.Dispose();
    }
}
