const { expect } = require("chai")
const { to1e18, to1ePrecision } = require("../helpers/contract-test-helpers")

describe("VendingMachine", () => {
  let wrappedToken
  let tToken
  // 1.45 in 1e18 precision
  // It means that for every 1 wrapped token (KEEP/NU), one will receive 1.45 T
  const ratio = "1450000000000000000"

  let vendingMachine

  // Token holder has 5 wrapped tokens (KEEP/NU)
  let tokenHolder
  const initialHolderBalance = to1e18(5)

  // Third party has no wrapped tokens and no T tokens.
  let thirdParty

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
    ;[tokenHolder, thirdParty] = await ethers.getSigners()
    await wrappedToken.mint(tokenHolder.address, initialHolderBalance)
  })

  describe("wrap", () => {
    context("when caller has no wrapped tokens", () => {
      it("should revert", async () => {
        const amount = 1
        await wrappedToken
          .connect(thirdParty)
          .approve(vendingMachine.address, amount)
        await expect(
          vendingMachine.connect(thirdParty).wrap(amount)
        ).to.be.revertedWith("Transfer amount exceeds balance")
      })
    })

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
          expect(await wrappedToken.balanceOf(tokenHolder.address)).to.equal(0)
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
          await expect(tx).to.emit(vendingMachine, "Wrapped").withArgs(
            tokenHolder.address,
            amount,
            to1ePrecision(725, 16) // 1.45 * 5 = 7.25
          )
        })

        it("should update wrapped balance", async () => {
          expect(
            await vendingMachine.wrappedBalance(tokenHolder.address)
          ).to.equal(amount)
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
          await expect(tx).to.emit(vendingMachine, "Wrapped").withArgs(
            tokenHolder.address,
            amount,
            to1ePrecision(145, 16) // 1.45 * 1 = 1.45
          )
        })

        it("should update wrapped balance", async () => {
          expect(
            await vendingMachine.wrappedBalance(tokenHolder.address)
          ).to.equal(amount)
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
        await expect(tx).to.emit(vendingMachine, "Wrapped").withArgs(
          tokenHolder.address,
          amount,
          to1ePrecision(29, 17) // 1.45 * 2 = 2.9
        )
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

    context("when caller has no T tokens", () => {
      it("should revert", async () => {
        const amount = 1
        await tToken.connect(thirdParty).approve(vendingMachine.address, amount)
        await expect(
          vendingMachine.connect(thirdParty).unwrap(amount)
        ).to.be.revertedWith("Transfer amount exceeds balance")
      })
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
      context("when unwrapping more than previously wrapped", () => {
        it("should revert", async () => {
          await tToken.mint(tokenHolder.address, to1e18(1))
          await tToken
            .connect(tokenHolder)
            .approve(vendingMachine.address, tAmount.add(to1e18(1)))
          await expect(
            vendingMachine.connect(tokenHolder).unwrap(tAmount.add(to1e18(1)))
          ).to.be.revertedWith("Can not unwrap more than previously wrapped")
        })
      })

      context("when unwrapping all that was previously wrapped", () => {
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

        it("should update wrapped balance", async () => {
          expect(
            await vendingMachine.wrappedBalance(tokenHolder.address)
          ).to.equal(0)
        })
      })

      context("when updating part of what was previously wrapped", () => {
        context("when unwrapping entire allowance", () => {
          let tx

          beforeEach(async () => {
            await tToken
              .connect(tokenHolder)
              .approve(vendingMachine.address, to1e18(2))
            tx = await vendingMachine.connect(tokenHolder).unwrap(to1e18(2))
          })

          it("should transfer T tokens to Vending Machine", async () => {
            expect(await tToken.balanceOf(vendingMachine.address)).to.equal(
              to1ePrecision(9765, 16) // 100 - 4.35 + 2 = 97.65
            )
            expect(await tToken.balanceOf(tokenHolder.address)).to.equal(
              to1ePrecision(235, 16) // 4.35 - 2 = 2.35
            )
          })

          it("should transfer wrapped tokens to token holder", async () => {
            expect(await wrappedToken.balanceOf(tokenHolder.address)).to.equal(
              "3379310344827586206" // 5 - 3 + 2/1.45 = 3.379310344827586206
            )
            expect(
              await wrappedToken.balanceOf(vendingMachine.address)
            ).to.equal(
              "1620689655172413794" // 3 - 2/1.45 = 1.620689655172413794
            )
          })

          it("should emit Unwrapped event", async () => {
            await expect(tx).to.emit(vendingMachine, "Unwrapped").withArgs(
              tokenHolder.address,
              to1e18(2),
              "1379310344827586206" // 2 / 1.45 = 1.379310344827586206
            )
          })

          it("should update wrapped balance", async () => {
            expect(
              await vendingMachine.wrappedBalance(tokenHolder.address)
            ).to.equal("1620689655172413794") // 3 - 2/1.45 = 1.620689655172413794
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
            expect(await tToken.balanceOf(vendingMachine.address)).to.equal(
              to1ePrecision(9665, 16) // 100 - 4.35 + 1 = 96.65
            )
            expect(await tToken.balanceOf(tokenHolder.address)).to.equal(
              to1ePrecision(335, 16) // 4.35 - 1 = 3.35
            )
          })

          it("should transfer wrapped tokens to token holder", async () => {
            expect(await wrappedToken.balanceOf(tokenHolder.address)).to.equal(
              "2689655172413793103" // 5 - 3 + 1/1.45 = 2.689655172413793103
            )
            expect(
              await wrappedToken.balanceOf(vendingMachine.address)
            ).to.equal(
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

          it("should update wrapped balance", async () => {
            expect(
              await vendingMachine.wrappedBalance(tokenHolder.address)
            ).to.equal("2310344827586206897") // 3 - 1/1.45 = 2.310344827586206897
          })
        })
      })
    })
  })
})
