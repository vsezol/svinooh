"""The things this service is about, with nothing technical attached.

Pure types and pure rules: no HTTP, no Redis, no model client, no framework.
Everything else in the service may import this package; it imports nothing back.
That one-way rule is what makes the layer worth having — a conversation means
the same thing whether it came out of Redis, an API or a test fixture.
"""
