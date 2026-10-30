namespace Surround.Desktop.Bridge;

/// <summary>Error returned to the UI as { error: { message, errors } }.</summary>
public sealed class BridgeException : Exception
{
    public IReadOnlyList<string> Errors { get; }

    public BridgeException(string message) : base(message) => Errors = Array.Empty<string>();

    public BridgeException(IReadOnlyList<string> errors)
        : base(string.Join(" ", errors)) => Errors = errors;
}
