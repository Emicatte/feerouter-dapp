"""AML-specific exceptions for financial operation gating."""


class AMLBlockedError(Exception):
    """Raised when AML screening blocks an operation."""
    pass


class AMLReviewRequired(Exception):
    """Raised when manual compliance review is needed before proceeding."""
    pass
