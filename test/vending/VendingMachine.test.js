const { expect } = require("chai")
const { to1e18, to1ePrecision } = require("../helpers/contract-test-helpers")

describe("VendingMachine", () => {
  let wrappedToken
  let tToken
  // 1.45 in 1e18 precision
  // It means that for every 1 wrapped token (KEEP/NU), one will receive 1.45 T
  const ratio = "1450000000000000000"

  let vendingMachine

  let tokenHolder
  // Token holder has 5 wrapped tokens (KEEP/NU)
  const initialHolderBalance = to1e18(5)

  beforeEach(async () => {
    const TestToken = await ethers.getContractFactory("TestToken")
    wrappedToken = await TestToken.deploy()
    await wrappedToken.deployed()

    const T = await ethers.getContractFactory("T")
    tToken = await T.deploy()
    await tToken.deployed()

    const VendingMachine = await ethers.getContractFactory("VendingMachine")
    vendingMachine = await VendingMachine.deploy(
      wrappedToken.address,
      tToken.address,
      ratio
    )
    await vendingMachine.deployed()

    // VendingMachine receives 100 T upon deployment
    await tToken.mint(vendingMachine.address, to1e18(100))

    tokenHolder = await ethers.getSigner(0)
    await wrappedToken.mint(tokenHolder.address, initialHolderBalance)
  })

  describe("wrap", () => {
    context("when token holder has not enough wrapped tokens", () => {
      it("should revert", async () => {
        const amount = initialHolderBalance.add(1)
        await wrappedToken
          .connect(tokenHolder)
          .approve(vendingMachine.address, amount)
        await expect(
          vendingMachine.connect(tokenHolder).wrap(amount)
        ).to.be.revertedWith("Transfer amount exceeds balance")
      })
    })

    context("when token holder has enough wrapped tokens", () => {
      context("when wrapping entire allowance", () => {
        const amount = to1e18(5)
        let tx

        beforeEach(async () => {
          await wrappedToken
            .connect(tokenHolder)
            .approve(vendingMachine.address, amount)
          tx = await vendingMachine.connect(tokenHolder).wrap(amount)
        })

        it("should transfer wrapped tokens to Vending Machine", async () => {
          expect(await wrappedToken.balanceOf(vendingMachine.address)).to.equal(
            amount
          )
          expect(await wrappedToken.balanceOf(tokenHolder.address)).to.equal(
            0 // 5 - 5 = 0
          )
        })

        it("should transfer T tokens to token holder", async () => {
          expect(await tToken.balanceOf(tokenHolder.address)).to.equal(
            to1ePrecision(725, 16) // 1.45 * 5 = 7.25
          )
          expect(await tToken.balanceOf(vendingMachine.address)).to.equal(
            to1ePrecision(9275, 16) // 100 - 7.25 = 92.75
          )
        })

        it("should emit Wrapped event", async () => {
          await expect(tx)
            .to.emit(vendingMachine, "Wrapped")
            .withArgs(tokenHolder.address, amount, to1ePrecision(725, 16))
        })
      })

      context("when wrapping part of the allowance", () => {
        const amount = to1e18(1)
        let tx

        beforeEach(async () => {
          await wrappedToken
            .connect(tokenHolder)
            .approve(vendingMachine.address, to1e18(5))

          tx = await vendingMachine.connect(tokenHolder).wrap(amount)
        })

        it("should transfer wrapped tokens to Vending Machine", async () => {
          expect(await wrappedToken.balanceOf(vendingMachine.address)).to.equal(
            amount
          )
          expect(await wrappedToken.balanceOf(tokenHolder.address)).to.equal(
            to1e18(4) // 5 - 1 = 4
          )
        })

        it("should transfer T tokens to token holder", async () => {
          expect(await tToken.balanceOf(tokenHolder.address)).to.equal(
            to1ePrecision(145, 16) // 1.45 * 1 = 1.45
          )
          expect(await tToken.balanceOf(vendingMachine.address)).to.equal(
            to1ePrecision(9855, 16) // 100 - 1.45 = 98.55
          )
        })

        it("should emit Wrapped event", async () => {
          await expect(tx)
            .to.emit(vendingMachine, "Wrapped")
            .withArgs(tokenHolder.address, amount, to1ePrecision(145, 16))
        })
      })
    })
  })

  describe("receiveApproval", () => {
    context("when called directly", () => {
      it("should revert", async () => {
        await expect(
          vendingMachine
            .connect(tokenHolder)
            .receiveApproval(
              tokenHolder.address,
              initialHolderBalance,
              wrappedToken.address,
              []
            )
        ).to.be.revertedWith("Only wrapped token caller allowed")
      })
    })

    context("when called not for the wrapped token", () => {
      it("should revert", async () => {
        await expect(
          tToken
            .connect(tokenHolder)
            .approveAndCall(vendingMachine.address, to1e18(1), [])
        ).to.be.revertedWith("Token is not the wrapped token")
      })
    })

    context("when called via wrapped token's approveAndCall", () => {
      const amount = to1e18(2)
      let tx

      beforeEach(async () => {
        tx = await wrappedToken
          .connect(tokenHolder)
          .approveAndCall(vendingMachine.address, amount, [])
      })

      it("should transfer wrapped tokens to Vending Machine", async () => {
        expect(await wrappedToken.balanceOf(vendingMachine.address)).to.equal(
          amount
        )
        expect(await wrappedToken.balanceOf(tokenHolder.address)).to.equal(
          to1e18(3) // 5 - 2 = 3
        )
      })

      it("should transfer T tokens to token holder", async () => {
        expect(await tToken.balanceOf(tokenHolder.address)).to.equal(
          to1ePrecision(29, 17) // 1.45 * 2 = 2.9
        )
        expect(await tToken.balanceOf(vendingMachine.address)).to.equal(
          to1ePrecision(971, 17) // 100 - 2.9 = 97.1
        )
      })

      it("should emit Wrapped event", async () => {
        await expect(tx)
          .to.emit(vendingMachine, "Wrapped")
          .withArgs(tokenHolder.address, amount, to1ePrecision(29, 17))
      })
    })
  })

  describe("unwrap", () => {
    const wrappedAmount = to1e18(3)
    const tAmount = to1ePrecision(435, 16) // 3 * 1.45 = 4.35

    beforeEach(async () => {
      await wrappedToken
        .connect(tokenHolder)
        .approve(vendingMachine.address, wrappedAmount)
      await vendingMachine.connect(tokenHolder).wrap(wrappedAmount)
    })

    context("when token holder has not enough T tokens", () => {
      it("should revert", async () => {
        const amount = tAmount.add(1)
        await tToken
          .connect(tokenHolder)
          .approve(vendingMachine.address, amount)
        await expect(
          vendingMachine.connect(tokenHolder).unwrap(amount)
        ).to.be.revertedWith("Transfer amount exceeds balance")
      })
    })

    context("when token holder has enough T tokens", () => {
      context("when unwrapping entire allowance", () => {
        let tx

        beforeEach(async () => {
          await tToken
            .connect(tokenHolder)
            .approve(vendingMachine.address, tAmount)
          tx = await vendingMachine.connect(tokenHolder).unwrap(tAmount)
        })

        it("should transfer T tokens to Vending Machine", async () => {
          expect(await tToken.balanceOf(vendingMachine.address)).to.equal(
            to1e18(100)
          )
          expect(await tToken.balanceOf(tokenHolder.address)).to.equal(0)
        })

        it("should transfer wrapped tokens to token holder", async () => {
          expect(await wrappedToken.balanceOf(tokenHolder.address)).to.equal(
            to1e18(5)
          )
          expect(await wrappedToken.balanceOf(vendingMachine.address)).to.equal(
            0
          )
        })

        it("should emit Unwrapped event", async () => {
          await expect(tx)
            .to.emit(vendingMachine, "Unwrapped")
            .withArgs(tokenHolder.address, tAmount, wrappedAmount)
        })
      })

      context("when unwrapping part of the allowance", () => {
        beforeEach(async () => {
          await tToken
            .connect(tokenHolder)
            .approve(vendingMachine.address, tAmount)
          tx = await vendingMachine.connect(tokenHolder).unwrap(to1e18(1))
        })

        it("should transfer T tokens to Vending Machine", async () => {
          expect(await tToken.balanceOf(tokenHolder.address)).to.equal(
            to1ePrecision(335, 16) // 4.35 - 1 = 3.35
          )
          expect(await tToken.balanceOf(vendingMachine.address)).to.equal(
            to1ePrecision(9665, 16) // 100 - 4.35 + 1 = 96.65
          )
        })

        it("should transfer wrapped tokens to token holder", async () => {
          expect(await wrappedToken.balanceOf(tokenHolder.address)).to.equal(
            "2689655172413793103" // 5 - 3 + 1/1.45 = 2.689655172413793103
          )
          expect(await wrappedToken.balanceOf(vendingMachine.address)).to.equal(
            "2310344827586206897" // 3 - 1/1.45 = 2.310344827586206897
          )
        })

        it("should emit Unwrapped event", async () => {
          await expect(tx).to.emit(vendingMachine, "Unwrapped").withArgs(
            tokenHolder.address,
            to1e18(1),
            "689655172413793103" // 1 / 1.45 = 0.689655172413793103
          )
        })
      })
    })
  })
})
