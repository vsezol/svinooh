"""The model and the rules — pure, and dependency-free.

Nothing in here reaches for the network, the clock, the environment or a
framework. That is not an aesthetic: it is what makes the rules testable
without a running service, and what stops a change of upstream from being a
change of meaning.
"""
