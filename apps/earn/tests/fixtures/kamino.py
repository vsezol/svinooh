"""Real upstream payloads, trimmed to the fields the code reads.

Taken from api.kamino.finance on 2026-09-10 and kept verbatim in shape: the
strings are Kamino's own, including the thirty-digit decimals and the
scientific notation, because those are exactly what a naive parser gets wrong.

`RecordedKamino` fits the `JsonTransport` port, so tests drive the *real*
`KaminoApi` — its pagination, its per-market fan-out, its joins — against these
payloads and no socket. A fake that replaced `KaminoApi` instead would leave
exactly the code most likely to be wrong untested.
"""
from typing import Any

VAULTS = [
    {
        "address": "A2wsxhA7pF4B2UKVfXocb6TAAP9ipfPJam6oMKgDE5BK",
        "programId": "KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd",
        "state": {
            "tokenMint": "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
            "tokenMintDecimals": 6,
            "tokenProgram": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
            "sharesMint": "DCqyVY1SFCwq8unnexv9pjujVAC7jsmjfoUWBrNLvbY",
            "sharesMintDecimals": 6,
            "performanceFeeBps": 500,
            "managementFeeBps": 0,
            "minDepositAmount": "100000",
            "name": "Sentora PYUSD",
            "vaultAllocationStrategy": [
                {
                    "reserve": "2gc9Dm1eB6UgVYFBUN9bWks6Kes9PbWSaPaa9DqyvEiN",
                    "targetAllocationWeight": 16840,
                    "ctokenAllocation": "35219143557113",
                },
                {
                    "reserve": "FswUCVjvfAuzHCgPDF95eLKscGsLHyJmD6hzkhq26CLe",
                    "targetAllocationWeight": 223,
                    "ctokenAllocation": "449052035728",
                },
                # Weight zero: the curator has moved off this reserve, so the
                # money is not there even though the strategy still lists it.
                {
                    "reserve": "DQ126djx5db6SMCbejHLNxoosonVes3qW5eVVUQuT93v",
                    "targetAllocationWeight": 0,
                    "ctokenAllocation": "1",
                },
            ],
        },
    },
    # Below any sensible TVL floor and named like what it is: reachable by id,
    # never listed.
    {
        "address": "CwptesNGAXj8S3aRsFHtUomb5zqAA1tMJBYkQVLJjXmd",
        "programId": "KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd",
        "state": {
            "tokenMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            "tokenMintDecimals": 6,
            "sharesMint": "5oZa6hoSA4zS6qQ15Bxq91vCA4R5rgqsjRQrA3rkV5FA",
            "sharesMintDecimals": 6,
            "performanceFeeBps": 0,
            "managementFeeBps": 0,
            "minDepositAmount": "0",
            "name": "Steakhouse USDC Testing",
            "vaultAllocationStrategy": [],
        },
    },
]

VAULT_METRICS_PAGES = [
    {
        "result": [
            {
                "kvault": "A2wsxhA7pF4B2UKVfXocb6TAAP9ipfPJam6oMKgDE5BK",
                "apy": "0.02575185788652079",
                "apyFarmRewards": "0.025042890119320038",
                "apyIncentives": "0",
                "apyReservesIncentives": "2.9845156439795040633e-14",
                "apy24h": "0.0542925253652127468",
                "apy7d": "0.05306269943658960168",
                "apy30d": "0.06255850765673319149",
                "apy90d": "0.06621649100243375281732388965277441",
                "apy365d": "0.0638284170423709089714972642230888",
                "tokensAvailable": "21594.317553",
                "tokensAvailableUsd": "21594.31755323831816",
                "tokensInvested": "135302187.976511",
                "tokensInvestedUsd": "135302187.97651143355",
                "numberOfHolders": 3667,
            }
        ],
        "paginationToken": "page-2",
    },
    {
        "result": [
            {
                "kvault": "CwptesNGAXj8S3aRsFHtUomb5zqAA1tMJBYkQVLJjXmd",
                "apy": "0",
                "apyFarmRewards": "0",
                "tokensAvailable": "0",
                "tokensAvailableUsd": "0",
                "tokensInvested": "5.000999",
                "tokensInvestedUsd": "5.00055621154854",
                "numberOfHolders": 1,
            }
        ],
        "paginationToken": None,
    },
]

MARKETS = [
    {"name": "SOL/BTC Market", "lendingMarket": "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"},
    {"name": "Ethena Market", "lendingMarket": "BJnbcRHqvppTyGesLzWASGKnmnF1wq9jZu6ExrjT7wvF"},
]

RESERVE_METRICS = {
    "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF": [
        {
            "reserve": "d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q",
            "liquidityToken": "SOL",
            "liquidityTokenMint": "So11111111111111111111111111111111111111112",
            "supplyApy": "0.045123456789",
            "borrowApy": "0.0597",
            "totalSupply": "2440000.5",
            "totalBorrow": "2190000.25",
            "totalSupplyUsd": "247820000.12",
            "totalBorrowUsd": "221000000.5",
        },
        # A reserve nobody uses — same floor applies to reserves as to vaults.
        {
            "reserve": "64AZMUHLB6NYvQSt41JTer4v8NAFDCz5sUPb7dYpCxa",
            "liquidityToken": "adraSOL",
            "liquidityTokenMint": "sctmY8fJucsJatwHz6P48RuWBBkdBMNmSMuBYrWFdrw",
            "supplyApy": "0",
            "borrowApy": "0.01621282549978087",
            "totalSupply": "66.318580553959613696",
            "totalBorrow": "4.652290903342168326695116320479428395629e-16",
            "totalSupplyUsd": "7408.39",
            "totalBorrowUsd": "5.197039286331876308813629536105353767805e-14",
        },
    ],
    "BJnbcRHqvppTyGesLzWASGKnmnF1wq9jZu6ExrjT7wvF": [
        {
            "reserve": "2gc9Dm1eB6UgVYFBUN9bWks6Kes9PbWSaPaa9DqyvEiN",
            "liquidityToken": "PYUSD",
            "liquidityTokenMint": "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
            "supplyApy": "0.0301",
            "borrowApy": "0.0455",
            "totalSupply": "90000000",
            "totalBorrow": "60000000",
            "totalSupplyUsd": "90000000.00",
            "totalBorrowUsd": "60000000.00",
        },
        {
            "reserve": "FswUCVjvfAuzHCgPDF95eLKscGsLHyJmD6hzkhq26CLe",
            "liquidityToken": "PYUSD",
            "liquidityTokenMint": "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
            "supplyApy": "0.0288",
            "borrowApy": "0.0441",
            "totalSupply": "12000000",
            "totalBorrow": "5000000",
            "totalSupplyUsd": "12000000.00",
            "totalBorrowUsd": "5000000.00",
        },
    ],
}


class RecordedKamino:
    """Kamino's API, answering from the payloads above and counting the calls."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    async def get(self, path: str, **params: Any) -> Any:
        self.calls.append(path)
        if path == "/kvaults/vaults":
            return VAULTS
        if path == "/kvaults/vaults/metrics":
            token = params.get("paginationToken")
            return VAULT_METRICS_PAGES[1] if token == "page-2" else VAULT_METRICS_PAGES[0]
        if path == "/v2/kamino-market":
            return MARKETS
        if path.startswith("/kamino-market/"):
            return RESERVE_METRICS[path.split("/")[2]]
        raise AssertionError(f"unexpected upstream call: {path}")
