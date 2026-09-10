"""The use cases, and the services they are built from.

What the product does, said in terms of ports rather than vendors: a chat
turn (turns.py), the conversations somebody may read (chats.py), and the
pieces those rest on — who is asking, how often they may, what a session
remembers. They depend on app/domain and on the protocols in app/ports,
never on an adapter, which is what lets the storage underneath change
without a line moving here.
"""
