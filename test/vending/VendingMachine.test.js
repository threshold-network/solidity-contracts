const { expect } = require("chai")
const { to1e18 } = require("../helpers/contract-test-helpers")

describe("VendingMachine", () => {
  let wrappedToken
  let tToken

  const floatingPointDivisor = to1e18(1)
  const tAllocation = to1e18("4500000000") // 4.5 Billion
  const maxWrappedTokens = to1e18("1100000000") // 1.1 Billion
  const expectedRatio = floatingPointDivisor
    .mul(tAllocation)
    .div(maxWrappedTokens)

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
      maxWrappedTokens,
      tAllocation
    )
    await vendingMachine.deployed()

    // VendingMachine receives 4.5 Billion T upon deployment
    await tToken.mint(vendingMachine.address, tAllocation)
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
        const amount = initialHolderBalance
        const expectedNewBalance = amount
          .mul(expectedRatio)
          .div(floatingPointDivisor)
        const expectedRemaining = tAllocation.sub(expectedNewBalance)
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
            expectedNewBalance
          )
          expect(await tToken.balanceOf(vendingMachine.address)).to.equal(
            expectedRemaining
          )
        })

        it("should emit Wrapped event", async () => {
          await expect(tx)
            .to.emit(vendingMachine, "Wrapped")
            .withArgs(tokenHolder.address, amount, expectedNewBalance)
        })

        it("should update wrapped balance", async () => {
          expect(
            await vendingMachine.wrappedBalance(tokenHolder.address)
          ).to.equal(amount)
        })
      })

      context("when wrapping part of the allowance", () => {
        const amount = to1e18(1)
        const expectedNewBalance = amount
          .mul(expectedRatio)
          .div(floatingPointDivisor)
        const expectedRemaining = tAllocation.sub(expectedNewBalance)
        let tx

        beforeEach(async () => {
          await wrappedToken
            .connect(tokenHolder)
            .approve(vendingMachine.address, initialHolderBalance)
          tx = await vendingMachine.connect(tokenHolder).wrap(amount)
        })

        it("should transfer wrapped tokens to Vending Machine", async () => {
          expect(await wrappedToken.balanceOf(vendingMachine.address)).to.equal(
            amount
          )
          expect(await wrappedToken.balanceOf(tokenHolder.address)).to.equal(
            initialHolderBalance.sub(amount)
          )
        })

        it("should transfer T tokens to token holder", async () => {
          expect(await tToken.balanceOf(tokenHolder.address)).to.equal(
            expectedNewBalance
          )
          expect(await tToken.balanceOf(vendingMachine.address)).to.equal(
            expectedRemaining
          )
        })

        it("should emit Wrapped event", async () => {
          await expect(tx)
            .to.emit(vendingMachine, "Wrapped")
            .withArgs(tokenHolder.address, amount, expectedNewBalance)
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
      const expectedNewBalance = amount
        .mul(expectedRatio)
        .div(floatingPointDivisor)
      const expectedRemaining = tAllocation.sub(expectedNewBalance)
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
          initialHolderBalance.sub(amount)
        )
      })

      it("should transfer T tokens to token holder", async () => {
        expect(await tToken.balanceOf(tokenHolder.address)).to.equal(
          expectedNewBalance
        )
        expect(await tToken.balanceOf(vendingMachine.address)).to.equal(
          expectedRemaining
        )
      })

      it("should emit Wrapped event", async () => {
        await expect(tx)
          .to.emit(vendingMachine, "Wrapped")
          .withArgs(tokenHolder.address, amount, expectedNewBalance)
      })
    })
  })

  describe("unwrap", () => {
    const wrappedAmount = to1e18(3)
    const tAmount = wrappedAmount.mul(expectedRatio).div(floatingPointDivisor)

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
            tAllocation
          )
          expect(await tToken.balanceOf(tokenHolder.address)).to.equal(0)
        })

        it("should transfer wrapped tokens to token holder", async () => {
          expect(await wrappedToken.balanceOf(tokenHolder.address)).to.equal(
            initialHolderBalance
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
          const tAmount2 = to1e18(2)
          const wrappedAmount2 = tAmount2
            .mul(floatingPointDivisor)
            .div(expectedRatio)
          const allocationLeft = tAllocation.sub(tAmount).add(tAmount2)
          const holderTBalance = tAmount.sub(tAmount2)
          let tx

          beforeEach(async () => {
            await tToken
              .connect(tokenHolder)
              .approve(vendingMachine.address, tAmount2)
            tx = await vendingMachine.connect(tokenHolder).unwrap(tAmount2)
          })

          it("should transfer T tokens to Vending Machine", async () => {
            expect(await tToken.balanceOf(vendingMachine.address)).to.equal(
              allocationLeft
            )
            expect(await tToken.balanceOf(tokenHolder.address)).to.equal(
              holderTBalance
            )
          })

          it("should transfer wrapped tokens to token holder", async () => {
            expect(await wrappedToken.balanceOf(tokenHolder.address)).to.equal(
              initialHolderBalance.sub(wrappedAmount).add(wrappedAmount2)
            )
            expect(
              await wrappedToken.balanceOf(vendingMachine.address)
            ).to.equal(wrappedAmount.sub(wrappedAmount2))
          })

          it("should emit Unwrapped event", async () => {
            await expect(tx)
              .to.emit(vendingMachine, "Unwrapped")
              .withArgs(tokenHolder.address, tAmount2, wrappedAmount2)
          })

          it("should update wrapped balance", async () => {
            expect(
              await vendingMachine.wrappedBalance(tokenHolder.address)
            ).to.equal(wrappedAmount.sub(wrappedAmount2))
          })
        })

        context("when unwrapping part of the allowance", () => {
          const tAmount2 = to1e18(1)
          const wrappedAmount2 = tAmount2
            .mul(floatingPointDivisor)
            .div(expectedRatio)

          beforeEach(async () => {
            await tToken
              .connect(tokenHolder)
              .approve(vendingMachine.address, tAmount)
            tx = await vendingMachine.connect(tokenHolder).unwrap(tAmount2)
          })

          it("should transfer T tokens to Vending Machine", async () => {
            expect(await tToken.balanceOf(vendingMachine.address)).to.equal(
              tAllocation.sub(tAmount).add(tAmount2)
            )
            expect(await tToken.balanceOf(tokenHolder.address)).to.equal(
              tAmount.sub(tAmount2)
            )
          })

          it("should transfer wrapped tokens to token holder", async () => {
            expect(await wrappedToken.balanceOf(tokenHolder.address)).to.equal(
              initialHolderBalance.sub(wrappedAmount).add(wrappedAmount2)
            )
            expect(
              await wrappedToken.balanceOf(vendingMachine.address)
            ).to.equal(wrappedAmount.sub(wrappedAmount2))
          })

          it("should emit Unwrapped event", async () => {
            await expect(tx)
              .to.emit(vendingMachine, "Unwrapped")
              .withArgs(tokenHolder.address, tAmount2, wrappedAmount2)
          })

          it("should update wrapped balance", async () => {
            expect(
              await vendingMachine.wrappedBalance(tokenHolder.address)
            ).to.equal(wrappedAmount.sub(wrappedAmount2))
          })
        })
      })
    })
  })
})
