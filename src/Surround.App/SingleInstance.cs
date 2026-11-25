namespace Surround.Desktop;

/// <summary>Per-user single instance: the first process owns a mutex and listens for an activation signal.</summary>
public sealed class SingleInstance : IDisposable
{
    /// <summary>
    /// A trial run (SURROUND_DATA_DIR, see AppPaths) gets its own lock and signal per data folder, so it opens next to
    /// an installed Surround instead of bringing that one to the front.
    /// </summary>
    private static readonly string Scope = Bridge.AppPaths.IsRedirected ? "." + StableId(Bridge.AppPaths.DataDir) : "";
    private static readonly string MutexName = @"Local\Surround.SingleInstance.5f0c8a1e" + Scope;
    private static readonly string SignalName = @"Local\Surround.Activate.5f0c8a1e" + Scope;

    private static string StableId(string path) => Convert.ToHexString(
        System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(path.ToUpperInvariant())))[..12];

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
